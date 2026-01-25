FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV, rembg, and image processing
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download rembg model (u2net) to avoid first-run delay
RUN python -c "from rembg import remove; print('rembg model downloaded')" || true

# Copy application
COPY . .

# Create data directories
RUN mkdir -p /app/data/projects /app/data/patches /app/data/models

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
