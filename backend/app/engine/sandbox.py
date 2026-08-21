import subprocess
import logging
import asyncio

logger = logging.getLogger(__name__)

def is_docker_available() -> bool:
    """
    Checks if Docker service is running and accessible.
    """
    try:
        res = subprocess.run(["docker", "ps"], capture_output=True, text=True, timeout=3)
        return res.returncode == 0
    except Exception:
        return False

async def run_code_in_sandbox(code_content: str, timeout: float = 5.0) -> tuple[bool, str, str]:
    """
    Executes Python code inside an isolated, resource-constrained Docker container.
    Pipes code directly through stdin to bypass host file mounting.
    
    Returns:
        (success: bool, stdout: str, stderr: str)
    """
    if not is_docker_available():
        raise RuntimeError("Docker is not available on the host machine.")

    # Docker command parameters:
    # --rm: clean container after exit
    # -i: keep stdin open for interactive stream piping
    # --network none: disable internet access inside container
    # --memory 128m: limit memory usage
    cmd = [
        "docker", "run", "--rm", "-i",
        "--network", "none",
        "--memory", "128m",
        "python:3.11-slim", "python"
    ]

    try:
        # Run subprocess asynchronously in thread pool to prevent blocking FastAPI
        def run_proc():
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            try:
                stdout, stderr = proc.communicate(input=code_content, timeout=timeout)
                return proc.returncode == 0, stdout, stderr
            except subprocess.TimeoutExpired:
                proc.kill()
                # Read whatever output was generated before timeout
                stdout, stderr = proc.communicate()
                return False, stdout, stderr + f"\n[ERROR] Execution timed out after {timeout} seconds."

        success, stdout, stderr = await asyncio.to_thread(run_proc)
        return success, stdout, stderr

    except Exception as e:
        logger.error(f"Sandbox execution error: {str(e)}")
        return False, "", f"Sandbox initialization error: {str(e)}"
