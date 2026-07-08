import subprocess, sys, json

def test_cli_quantify_exact(tmp_path):
    out = subprocess.run([sys.executable, "-m", "psaengine.cli", "quantify",
                          "examples/tiny_and.json", "--method", "exact"],
                         capture_output=True, text=True)
    assert out.returncode == 0
    assert "0.02" in out.stdout
