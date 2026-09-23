# Intelligence evaluation

AOI and WATT manifests define required benchmark categories and result fields.
Actual systems or authorized evaluators produce result JSON; the harness validates
evidence/reproducibility and emits a deterministic result hash. It does not
generate synthetic benchmark success or assign maturity levels.

```bash
PYTHONPATH=src python evaluation/run_evaluation.py path/to/result.json
```
