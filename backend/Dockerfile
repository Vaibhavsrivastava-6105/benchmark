FROM python:3.11-slim

WORKDIR /workspace

# Install system dependencies (for psutil compilation if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

ENV PYTHONUNBUFFERED=1
ENV DEMO_MODE=true

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
