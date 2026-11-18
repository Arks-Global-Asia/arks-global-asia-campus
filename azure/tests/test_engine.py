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
