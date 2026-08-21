from typing import AsyncIterator, Optional
from pydantic import BaseModel

class GenerationResult(BaseModel):
    text: str
    prompt_tokens: int
    output_tokens: int
    total_tokens: int
    ttft_ms: Optional[float] = None          # First token latency in milliseconds (if streaming)
    total_time_ms: float                     # Full request duration in milliseconds
    first_token_time: Optional[int] = None   # Epoch microseconds
    finish_time: Optional[int] = None        # Epoch microseconds
    error: Optional[str] = None
    token_count_source: str = "unknown"      # provider, tokenizer, estimated, unknown

class InferenceProvider:
    def __init__(self, provider_id: int, name: str, base_url: str, api_key: Optional[str] = None, settings: Optional[dict] = None):
        self.provider_id = provider_id
        self.name = name
        self.base_url = base_url
        self.api_key = api_key
        self.settings = settings or {}

    async def health_check(self) -> bool:
        """
        Check if the inference server is online and responding.
        """
        raise NotImplementedError

    async def health_check_detailed(self) -> dict:
        """
        Check health and return dict with 'online' and 'error'.
        Default falls back to health_check() without error info.
        """
        online = await self.health_check()
        return {"online": online, "error": None if online else "Offline / No specific error returned"}

    async def get_models(self) -> list[str]:
        """
        Fetch models available on the provider.
        """
        raise NotImplementedError

    async def generate(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> GenerationResult:
        """
        Execute non-streaming generation.
        """
        raise NotImplementedError

    async def generate_stream(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> AsyncIterator[dict]:
        """
        Execute streaming generation yielding chunks for real-time updates and TTFT calculation.
        """
        raise NotImplementedError
