import io
import json
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'function'))
from engine import extract, generate, evaluate, source_text
from scanner import ScanError
class EngineTests(unittest.TestCase):
    def test_office_extraction_and_image_rejection(self):
        f=io.BytesIO()
        with zipfile.ZipFile(f,'w') as z:z.writestr('word/document.xml','<w:document xmlns:w="word"><w:t>Safe Git notes</w:t></w:document>')
        self.assertEqual(extract(f.getvalue(),'notes.docx'),'Safe Git notes')
        self.assertEqual(extract(b'not an OCR document','notes.png'),'')
    def test_video_link_is_not_treated_as_transcript(self):
        with self.assertRaises(ScanError):source_text(None,{'payload':{'resources':[{'kind':'recording','title':'Class','body':'Watch this recording'}]}})
    def test_mixed_generation_preserves_requested_types(self):
        def mock_ai(system,content):
            data=json.loads(content)
            return {'questions':[{'type':t,'prompt':t+str(i)} for i,t in enumerate(data['requested_types'])]}
        with patch('engine.source_text',return_value='approved '*100),patch('engine.deepseek',side_effect=mock_ai):
            qs=generate(None,{'payload':{'count':4,'question_types':['mcq','code','essay','matching']}})['questions']
        self.assertEqual([q['type'] for q in qs],['mcq','code','essay','matching'])
    def test_evaluation_carries_rubric_and_marks(self):
        def mock_ai(system,content):
            d=json.loads(content);self.assertEqual(d[0]['question']['rubric'],'Explain rollback');self.assertIn('Do not execute code',system)
            return {'feedback':[{'marks':5,'feedback':'Add verification.'}]}
        with patch('engine.deepseek',side_effect=mock_ai):
            r=evaluate({'payload':{'questions':[{'type':'code','rubric':'Explain rollback','marks':10}],'answers':['kubectl rollout undo']}})
        self.assertEqual(r['feedback'][0]['marks'],5)

class SubmissionFolderTests(unittest.TestCase):
    def test_submission_creates_batch_labs_answers_and_student_folder_then_reuses_upload(self):
        from engine import upload_submission
        from unittest.mock import Mock
        job={'payload':{'folder_id':'batch_root_123456','folder_is_batch_root':True,'student_name':'Anil / Kumar','student_id':'student-uuid','submission_id':'submission-uuid','file':{'id':'file','name':'answer.pdf'}}}
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.json.return_value={'files':[{'id':'already_uploaded'}]}
        with patch('engine.drive_session',return_value=Mock()),patch('engine.ensure_folder',side_effect=['labs-id','answers-id','student-id']) as folders,patch('engine.request',return_value=response):
            result=upload_submission(None,job)
        self.assertEqual(result['url'],'https://drive.google.com/file/d/already_uploaded/view')
        calls=folders.call_args_list
        self.assertEqual(calls[0].args[1:],('batch_root_123456','labs'))
        self.assertEqual(calls[1].args[1:],('labs-id','lab_answers'))
        self.assertEqual(calls[2].args[1:],('answers-id','Anil _ Kumar','student-uuid'))
