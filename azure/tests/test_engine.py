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
    def test_office_yaml_script_extraction_and_image_metadata_in_source_text(self):
        f = io.BytesIO()
        with zipfile.ZipFile(f, 'w') as z:
            z.writestr('word/document.xml', '<w:document xmlns:w="word"><w:t>Safe Git notes</w:t></w:document>')
        self.assertEqual(extract(f.getvalue(), 'notes.docx'), 'Safe Git notes')
        self.assertEqual(extract(b'not an OCR document', 'notes.png'), '')
        self.assertEqual(extract(b'apiVersion: v1\nkind: Pod', 'pod.yaml'), 'apiVersion: v1\nkind: Pod')
        self.assertEqual(extract(b'#!/bin/bash\nkubectl get pods', 'deploy.sh'), '#!/bin/bash\nkubectl get pods')

        text = source_text(None, {
            'payload': {
                'resources': [
                    {'kind': 'image', 'title': 'VPC Peering Diagram', 'topic': 'Azure Networking', 'body': ''},
                    {'kind': 'guide', 'title': 'AKS Cluster Creation Guide', 'topic': 'Kubernetes', 'body': 'az aks create --resource-group rg-arks --name aks-prod --node-count 3 --enable-managed-identity'},
                ]
            }
        })
        self.assertIn('[Architecture Diagram / Visual Reference: VPC Peering Diagram - Topic: Azure Networking]', text)
        self.assertIn('az aks create --resource-group rg-arks', text)

    def test_video_link_is_not_treated_as_transcript(self):
        with self.assertRaises(ScanError):
            source_text(None, {'payload': {'resources': [{'kind': 'recording', 'title': 'Class', 'body': 'Watch this recording'}]}})

    def test_mixed_generation_preserves_requested_types_and_batches_20_plus_questions(self):
        calls = []

        def mock_ai(system, content):
            data = json.loads(content)
            calls.append(data['requested_types'])
            self.assertIn('YAML manifests', system)
            base_idx = len(data['earlier_questions'])
            return {
                'questions': [
                    {'type': t, 'prompt': f'Question {base_idx + i + 1} ({t}): Explain Kubernetes pod deployment'}
                    for i, t in enumerate(data['requested_types'])
                ]
            }

        all_types = ['mcq', 'multi_select', 'true_false', 'fill_blank', 'short_answer', 'scenario', 'code', 'matching', 'ordering']
        with patch('engine.source_text', return_value='approved class notes ' * 50), patch('engine.deepseek', side_effect=mock_ai):
            qs = generate(None, {'payload': {'count': 22, 'question_types': all_types}})['questions']

        self.assertEqual(len(qs), 22)
        self.assertEqual([len(batch) for batch in calls], [6, 6, 6, 4])
        self.assertEqual([q['type'] for q in qs[:9]], all_types)

    def test_generation_rejects_duplicate_questions(self):
        def mock_dup(system, content):
            data = json.loads(content)
            return {'questions': [{'type': t, 'prompt': 'Same prompt repeated'} for t in data['requested_types']]}

        with patch('engine.source_text', return_value='approved class notes ' * 50), patch('engine.deepseek', side_effect=mock_dup):
            with self.assertRaises(ScanError):
                generate(None, {'payload': {'count': 2, 'question_types': ['mcq']}})

    def test_evaluation_carries_rubric_marks_and_diagnostic_summary(self):
        call_count = {'n': 0}

        def mock_ai(system, content):
            call_count['n'] += 1
            if 'attempt_digest' in content:
                digest = json.loads(content)['attempt_digest']
                self.assertEqual(len(digest), 2)
                return {
                    'strengths': ['Strong Kubernetes rollout command knowledge'],
                    'improvements': ['Include rollout status verification and readiness checks'],
                    'recommendations': [
                        {
                            'title': 'Kubernetes Deployments Official Docs',
                            'category': 'official_doc',
                            'url': 'https://kubernetes.io/docs/concepts/workloads/controllers/deployment/',
                            'description': 'Review kubectl rollout undo and status commands.',
                        },
                        {
                            'title': 'Batch Class Notes & Recording — Kubernetes',
                            'category': 'notes',
                            'url': '',
                            'description': 'Revisit Topic 4 notes on zero-downtime rollbacks.',
                        },
                    ],
                }
            d = json.loads(content)
            self.assertEqual(d[0]['question']['rubric'], 'Explain rollback')
            self.assertIn('Do not execute code', system)
            return {'feedback': [{'marks': 5, 'feedback': 'Add verification.'}, {'marks': 10, 'feedback': 'Correct YAML.'}]}

        with patch('engine.deepseek', side_effect=mock_ai):
            r = evaluate({
                'payload': {
                    'questions': [
                        {'type': 'code', 'prompt': 'Rollback command', 'rubric': 'Explain rollback', 'marks': 10},
                        {'type': 'scenario', 'prompt': 'Pod probe config', 'rubric': 'Liveness probe', 'marks': 10},
                    ],
                    'answers': ['kubectl rollout undo', 'livenessProbe: httpGet'],
                }
            })
        self.assertEqual(r['feedback'][0]['marks'], 5)
        self.assertEqual(r['feedback'][1]['marks'], 10)
        self.assertIn('strengths', r['summary'])
        self.assertIn('improvements', r['summary'])
        self.assertEqual(len(r['summary']['recommendations']), 2)
        self.assertEqual(r['summary']['recommendations'][0]['category'], 'official_doc')


if __name__ == '__main__':
    unittest.main()
