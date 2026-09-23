#!/usr/bin/env python3
"""Validate and hash externally produced AOI/WATT benchmark result records."""
import argparse,json,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/"src"))
from kindred_superstructure.intelligence import BenchmarkResult,IntelligenceEvaluator

def main():
    parser=argparse.ArgumentParser();parser.add_argument("result",type=Path);args=parser.parse_args()
    data=json.loads(args.result.read_text()); data["allowed_capabilities"]=tuple(data["allowed_capabilities"]);data["evidence"]=tuple(data["evidence"])
    outcome=IntelligenceEvaluator().record(BenchmarkResult(**data));print(json.dumps(outcome,sort_keys=True));return 0
if __name__=="__main__":raise SystemExit(main())
