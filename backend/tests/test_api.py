import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db
from app import models

# Use in-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_database():
    # Clean up completely first to avoid IntegrityError across tests
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    
    # Insert some seed data
    db = TestingSessionLocal()
    db.add(models.Provider(name="Test Provider", type="openai_compatible", base_url="http://test", setup_complexity="low"))
    db.add(models.Model(name="test_model", revision=None, quantization=None, context_length=2048, parameters="7B", architecture="llama"))
    db.add(models.PromptSuite(name="Test Suite"))
    db.commit()
    
    suite = db.query(models.PromptSuite).first()
    db.add(models.Prompt(suite_id=suite.id, prompt="Hello world", category="General"))
    db.commit()
    db.close()
    
    yield
    Base.metadata.drop_all(bind=engine)

def test_get_providers():
    response = client.get("/api/providers")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Test Provider"
    assert data[0]["setup_complexity"] == "low"

def test_get_models():
    response = client.get("/api/models")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "test_model"

def test_create_benchmark():
    # Test creating a multi-model matrix benchmark
    payload = {
        "name": "Integration Test Run",
        "provider_ids": [1],
        "prompt_suite_ids": [1],
        "model_names": ["test_model", "another_model"],
        "benchmark_mode": "standard",
        "config_create": {
            "name": "Test Config",
            "temperature": 0.5,
            "top_p": 1.0,
            "top_k": 50,
            "seed": 42,
            "max_tokens": 100,
            "repetitions": 1,
            "warmup_requests": 0,
            "concurrency": 1
        }
    }
    
    response = client.post("/api/benchmarks", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Integration Test Run"
    assert data["status"] == "PENDING"
    
    # Verify hardware_info properly captured model_names
    assert "model_names" in data["hardware_info"]
    assert len(data["hardware_info"]["model_names"]) == 2
    assert "another_model" in data["hardware_info"]["model_names"]

def test_get_run_details():
    # First create one
    payload = {
        "name": "Another Run",
        "provider_ids": [1],
        "prompt_suite_ids": [1],
        "model_names": ["test_model"],
        "config_create": {
            "name": "Config",
            "temperature": 0.0,
            "max_tokens": 100,
            "repetitions": 1,
            "warmup_requests": 0,
            "concurrency": 1
        }
    }
    create_res = client.post("/api/benchmarks", json=payload)
    run_id = create_res.json()["id"]
    
    # Now get it
    response = client.get(f"/api/runs/{run_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Another Run"

def test_get_telemetry():
    response = client.get("/api/hardware")
    assert response.status_code == 200
    data = response.json()
    assert "static" in data
    assert "live" in data
    
