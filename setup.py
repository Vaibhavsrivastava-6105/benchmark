import os
import sys
import subprocess
import urllib.request
import json
import zipfile
import tarfile
import platform
import stat
import shutil

def run_cmd(cmd):
    print(f"Running: {cmd}")
    subprocess.check_call(cmd, shell=True)

def main():
    print("=============================================")
    print(" BenchLab Universal Cross-Platform Setup")
    print("=============================================")
    print("Detecting Operating System...")
    sys_os = platform.system().lower()
    arch = platform.machine().lower()
    
    print(f"OS: {sys_os.capitalize()}, Arch: {arch}")
    
    print("\n1. Installing Backend Python Dependencies...")
    reqs_cmd = f"{sys.executable} -m pip install -r backend/requirements.txt"
    run_cmd(reqs_cmd)
    
    # Specific torch versions
    if sys_os == 'windows' or sys_os == 'linux':
        print("\n2. Installing CUDA-optimized PyTorch...")
        run_cmd(f"{sys.executable} -m pip install torch torchvision torchaudio accelerate --index-url https://download.pytorch.org/whl/cu121")
    else:
        print("\n2. Installing PyTorch (Mac Metal)...")
        run_cmd(f"{sys.executable} -m pip install torch torchvision torchaudio accelerate")
    
    # Setup Llama.cpp binary
    print("\n3. Downloading native llama.cpp binaries for your system...")
    bin_dir = os.path.join('backend', 'bin', 'llama-cpp')
    os.makedirs(bin_dir, exist_ok=True)
    
    req = urllib.request.Request("https://api.github.com/repos/ggerganov/llama.cpp/releases/latest", headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            assets = data['assets']
            
            # Heuristic match
            target_asset = None
            if sys_os == 'windows':
                # Prefer CUDA on Windows x64
                matches = [a for a in assets if 'win-cuda' in a['name'] and 'x64' in a['name'] and not a['name'].startswith('cudart')]
                target_asset = matches[0] if matches else [a for a in assets if 'win-vulkan-x64' in a['name']][0]
            elif sys_os == 'darwin':
                # Mac Metal
                matches = [a for a in assets if 'macos' in a['name'] and ('arm64' in arch and 'arm64' in a['name'] or 'x64' in arch and 'x64' in a['name'])]
                if matches: target_asset = matches[0]
            elif sys_os == 'linux':
                matches = [a for a in assets if 'ubuntu' in a['name'] and ('x64' in a['name'] or 'x86_64' in arch)]
                if matches: target_asset = matches[0]
            
            if target_asset:
                print(f"Found compatible release: {target_asset['name']}")
                file_path = os.path.join(bin_dir, target_asset['name'])
                urllib.request.urlretrieve(target_asset['browser_download_url'], file_path)
                
                # Extract
                if file_path.endswith('.zip'):
                    with zipfile.ZipFile(file_path, 'r') as zip_ref:
                        zip_ref.extractall(bin_dir)
                elif file_path.endswith('.tar.gz'):
                    with tarfile.open(file_path, 'r:gz') as tar_ref:
                        tar_ref.extractall(bin_dir)
                os.remove(file_path)
                
                # Make executable on Mac/Linux
                if sys_os != 'windows':
                    for f in os.listdir(bin_dir):
                        if 'llama-server' in f:
                            os.chmod(os.path.join(bin_dir, f), stat.S_IRWXU)
                print("  [OK] llama.cpp downloaded and extracted.")
            else:
                print("  [WARNING] Could not auto-detect llama.cpp binary for your architecture. You may need to compile it manually.")
    except Exception as e:
        print(f"  [ERROR] Failed to download llama.cpp: {e}")

    print("\n4. Downloading lightweight test model (Qwen2.5-0.5B-GGUF)...")
    try:
        from huggingface_hub import hf_hub_download
        model_path = hf_hub_download(repo_id='Qwen/Qwen2.5-0.5B-Instruct-GGUF', filename='qwen2.5-0.5b-instruct-q4_k_m.gguf')
        shutil.copy(model_path, os.path.join(bin_dir, 'model.gguf'))
        print('  [OK] Model downloaded to backend/bin/llama-cpp/model.gguf')
    except Exception as e:
        print(f"  [ERROR] Model download failed: {e}")

    
    print("\n5. Checking for Docker (Optional for vLLM support)...")
    try:
        subprocess.check_call("docker --version", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("  [OK] Docker is installed. Pulling vLLM image for high-end GPUs...")
        run_cmd("docker pull vllm/vllm-openai:latest")
    except Exception:
        print("  [INFO] Docker not found. Skipping vLLM setup. Install Docker if you want to run vLLM.")

    print("\n=============================================")
    print(" Setup Complete!")
    print(" You can now run the UI with:")
    print("   cd frontend && npm install && npm run dev")
    print(" And the backend with:")
    print("   cd backend && uvicorn app.main:app --port 8001")
    print("=============================================")

if __name__ == '__main__':
    main()
