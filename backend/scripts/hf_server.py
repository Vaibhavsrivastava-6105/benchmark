import os
import argparse
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import time
import uuid

app = FastAPI(title="Hugging Face OpenAI-Compatible Server")
model = None
tokenizer = None
model_name_global = "unloaded"

@app.on_event("startup")
async def load_model():
    global model, tokenizer, model_name_global
    
    # Check if a model is specified in environment
    model_name_global = os.getenv("HF_MODEL_NAME", "unsloth/Llama-3.2-1B")
    
    print(f"Loading {model_name_global} on CUDA...")
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import torch
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        tokenizer = AutoTokenizer.from_pretrained(model_name_global)
        model = AutoModelForCausalLM.from_pretrained(
            model_name_global, 
            device_map=device,
            torch_dtype=torch.float16
        )
        print(f"Loaded successfully on {device}!")
    except Exception as e:
        print(f"Failed to load model: {e}")

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    global model, tokenizer
    if model is None or tokenizer is None:
        return JSONResponse({"error": "Model not loaded"}, status_code=500)
        
    data = await request.json()
    messages = data.get("messages", [])
    max_tokens = data.get("max_tokens", 100)
    temperature = data.get("temperature", 0.7)
    
    # Format messages
    prompt = ""
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        prompt += f"<|im_start|>{role}\n{content}<|im_end|>\n"
    prompt += "<|im_start|>assistant\n"
    
    start_time = time.time()
    
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    
    output_ids = model.generate(
        inputs.input_ids, 
        max_new_tokens=max_tokens,
        temperature=temperature,
        pad_token_id=tokenizer.eos_token_id
    )
    
    # Decode only the newly generated tokens
    new_tokens = output_ids[0][len(inputs.input_ids[0]):]
    generated_text = tokenizer.decode(new_tokens, skip_special_tokens=True)
    
    return {
        "id": f"chatcmpl-{uuid.uuid4()}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_name_global,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": generated_text
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": len(inputs.input_ids[0]),
            "completion_tokens": len(new_tokens),
            "total_tokens": len(inputs.input_ids[0]) + len(new_tokens)
        }
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default="unsloth/Llama-3.2-1B")
    parser.add_argument("--port", type=int, default=8003)
    args = parser.parse_args()
    
    os.environ["HF_MODEL_NAME"] = args.model
    uvicorn.run(app, host="0.0.0.0", port=args.port)
