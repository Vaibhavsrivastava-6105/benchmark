from typing import Optional
from app.providers.base import InferenceProvider
from app.providers.ollama import OllamaProvider
from app.providers.openai_compatible import OpenAICompatibleProvider
from app.providers.transformers import TransformersProvider
from app.providers.mock import MockProvider

def get_provider_client(
    provider_id: int,
    provider_type: str,
    name: str,
    base_url: str,
    api_key: Optional[str] = None,
    settings: Optional[dict] = None
) -> InferenceProvider:
    """
    Factory function to retrieve the appropriate InferenceProvider client instance.
    """
    ptype = provider_type.lower()
    
    # Check for demo mode / mock
    if ptype == "mock":
        return MockProvider(provider_id, name, base_url, api_key, settings)
    elif ptype == "ollama":
        return OllamaProvider(provider_id, name, base_url, api_key, settings)
    elif ptype == "transformers":
        return TransformersProvider(provider_id, name, base_url, api_key, settings)
    elif ptype in ["vllm", "llamacpp", "llama.cpp", "openai_compatible", "sglang", "tgi", "tensorrt", "openai"]:
        return OpenAICompatibleProvider(provider_id, name, base_url, api_key, settings)
    else:
        # Fallback to OpenAI compatible adapter for arbitrary endpoint
        return OpenAICompatibleProvider(provider_id, name, base_url, api_key, settings)
