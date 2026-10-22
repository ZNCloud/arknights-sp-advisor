"""python -m unittest distill/test_distill.py  (needs torch; run from the checkout root)"""
import datetime, os, sys, unittest
import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idle  # noqa: E402
from model import build, unit_layout  # noqa: E402
from train import losses, normalize, CLIP  # noqa: E402

T = {'tau': 0.05, 'w_util': 1, 'w_kl': 1, 'w_pick': 0.2, 'w_line': 0.2, 'w_value': 0.1}


class Losses(unittest.TestCase):
    def batch(self, line, line_ok):
        V, L = 4, 3
        U = torch.tensor([[0.5, 0.6, float('nan'), 0.4]])
        return {'U': U, 'legal': torch.tensor([[True, True, True, False]]), 'line_ok': torch.tensor([line_ok]),
                'pick': torch.tensor([1]), 'line': torch.tensor([line]), 'z': torch.tensor([0.5]), 'w': torch.tensor([1.0])}

    def out(self):
        return {'q': torch.tensor([[0.5, 0.6, 0.0, 9.0]], requires_grad=True), 'line': torch.zeros(1, 3, requires_grad=True), 'value': torch.tensor([0.5])}

    def test_unlabelled_and_illegal_actions_do_not_count(self):
        total, st = losses(self.out(), self.batch(0, [True, True, False]), T)
        self.assertAlmostEqual(st['util'], 0.0, places=6)       # q matches U on the labelled legal actions; slot 3 is illegal
        self.assertEqual(st['top1'], 1.0)
        self.assertTrue(torch.isfinite(total))

    def test_line_label_outside_the_available_lines_is_skipped(self):
        total, st = losses(self.out(), self.batch(2, [True, True, False]), T)
        self.assertEqual(st['line'], 0.0)
        self.assertTrue(torch.isfinite(total))

    def test_normalize_clips(self):
        x = normalize(torch.tensor([1e6, -1e6, 1.0]), torch.zeros(3), torch.ones(3))
        self.assertEqual(x.tolist(), [CLIP, -CLIP, 1.0])


class Models(unittest.TestCase):
    names = ['round', 'lp'] + [f'board{i}.{k}' for i in range(2) for k in ('tier', 'atk')] + [f'shop{i}.{k}' for i in range(2) for k in ('tier', 'atk')] + ['bond.x.layers']

    def test_unit_layout(self):
        units, rest = unit_layout(self.names)
        self.assertEqual([(k, s, w) for k, s, _, w in units], [('board', 0, 2), ('board', 1, 2), ('shop', 0, 2), ('shop', 1, 2)])
        self.assertEqual(rest, [0, 1, 10])

    def test_both_archs_give_the_three_heads(self):
        for arch in ('mlp', 'transformer'):
            m = build(arch, self.names, 5, 3, hidden=(16, 8), d=16, layers=1, heads=2)
            o = m(torch.randn(4, len(self.names)))
            self.assertEqual((tuple(o['q'].shape), tuple(o['line'].shape), tuple(o['value'].shape)), ((4, 5), (4, 3), (4,)))


class Idle(unittest.TestCase):
    def test_hours(self):
        at = lambda h: datetime.datetime(2026, 10, 22, h, 30)
        self.assertTrue(idle.in_hours([], at(12)))
        self.assertTrue(idle.in_hours(['00-09', '20-24'], at(3)))
        self.assertFalse(idle.in_hours(['00-09', '20-24'], at(12)))

    def test_check_reports_reasons(self):
        r = idle.check({'cpu_load_per_core_max': -1, 'busy_patterns': [], 'busy_containers': []})
        self.assertFalse(r['idle'])
        self.assertTrue(any(x.startswith('CPU:') for x in r['reasons']))
        r = idle.check({'cpu_load_per_core_max': 1e9, 'mem_available_gb_min': 0, 'gpu_other_mem_mib_max': 1e9, 'gpu_util_max': 101,
                        'busy_patterns': [], 'busy_containers': []})
        self.assertTrue(r['idle'], r['reasons'])

    def test_own_process_tree_is_not_a_busy_job(self):
        self.assertIn(os.getpid(), idle.own_tree())
        hits = idle.busy_processes(['test_distill'], idle.own_tree())
        self.assertFalse(any(h['pid'] == os.getpid() for h in hits))


if __name__ == '__main__':
    unittest.main()
