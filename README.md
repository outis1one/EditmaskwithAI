# AI Photo Edit

AI Photo Edit is a self-hosted, web-based image editing tool that allows you to regenerate only a selected area of a photo using AI.

## Core Concept

**Have AI regenerate only a selected area of a photo.**

- Upload an image
- Select a specific region (rectangle, ellipse, or freehand lasso)
- Enter a prompt describing what to fix
- Have AI regenerate only the selected region
- Composite the regenerated region back into the original image
- Preserve every pixel outside the selection
- Maintain full edit history and reversibility

**The system does not regenerate the entire image.**
**The system does not alter any pixel outside the selected mask.**

## Features

### Selection Tools
- **Rectangle**: Click and drag to select rectangular regions
- **Ellipse**: Click and drag to select elliptical regions
- **Lasso**: Draw freehand selections around irregular shapes

### AI Modes
- **Mode A (Default)**: Send only the selected patch
  - Faster processing
  - Lower cost
  - Best for isolated fixes

- **Mode B**: Send patch + full image reference
  - Better style consistency
  - More context-aware results
  - Higher cost

### Edge Blending
- Adjustable feather slider (0-50 pixels)
- Smooth blending at selection edges
- Prevents harsh transitions

### Edit History
- Full history of all edits
- Revert to any previous edit
- Reset to original image
- All edits are reversible

## Architecture

```
AI Photo Edit
├── Frontend (React + Fabric.js)
│   ├── Image canvas with selection tools
│   ├── Controls (mode, feather, prompt)
│   └── Edit history viewer
│
├── Backend (FastAPI)
│   ├── Image processing
│   ├── AI provider integration
│   ├── Database (SQLite)
│   └── File storage
│
└── Docker Compose
    ├── Backend service
    └── Frontend service (nginx)
```

## Installation

### Prerequisites
- Docker and Docker Compose
- AI API key (OpenAI or Stability AI) for production use

### Quick Start

1. **Clone the repository**
```bash
git clone <repository-url>
cd EditmaskwithAI
```

2. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` and set your AI provider:
```env
# For OpenAI (DALL-E)
AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key-here

# OR for Stability AI
AI_PROVIDER=stability
STABILITY_API_KEY=your-stability-api-key-here

# OR for testing (no AI, returns original)
AI_PROVIDER=mock
```

3. **Start the application**
```bash
docker-compose up -d
```

4. **Access the application**
- Frontend: http://localhost
- Backend API: http://localhost:8000
- API Documentation: http://localhost:8000/docs

### Development Setup

For development with hot-reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

- Frontend: http://localhost:5173 (Vite dev server)
- Backend: http://localhost:8000 (auto-reload enabled)

## Usage

### 1. Create a Project
- Enter a project name
- Upload your image (PNG, JPG, etc.)
- Click "Create Project"

### 2. Select an Area
- Choose a selection tool (Rectangle, Ellipse, or Lasso)
- Draw your selection on the image
- Adjust the selection if needed

### 3. Configure Edit
- **AI Mode**: Choose Mode A (faster) or Mode B (better context)
- **Feather**: Adjust edge blending (0-50 pixels)
- **Prompt**: Describe what you want to change

Examples:
- "Remove the person"
- "Change sky to sunset"
- "Fix the red eye"
- "Add flowers"

### 4. Process Edit
- Click "Fix Selected Area"
- Wait for AI processing (status shown in history)
- View the result on the canvas

### 5. Manage History
- View all edits in the history panel
- Revert to any previous edit
- Reset to original image anytime

## API Documentation

### Projects

**Create Project**
```
POST /projects/
Body: { "name": "My Project" }
```

**Upload Image**
```
POST /projects/{project_id}/upload
Body: multipart/form-data with image file
```

**List Projects**
```
GET /projects/
```

**Get Project**
```
GET /projects/{project_id}
```

### Edits

**Create Edit**
```
POST /edits/projects/{project_id}/fix
Body: {
  "prompt": "Remove the object",
  "mode": "A",
  "selection_type": "rectangle",
  "bbox": { "x": 100, "y": 100, "width": 200, "height": 200 },
  "feather_px": 5,
  "selection_data": null
}
```

**Get Edit Status**
```
GET /edits/{edit_id}
```

**Revert to Edit**
```
POST /edits/projects/{project_id}/revert/{edit_id}
```

**Reset to Original**
```
POST /edits/projects/{project_id}/reset
```

### Images

**Get Original Image**
```
GET /projects/{project_id}/original
```

**Get Current Image**
```
GET /projects/{project_id}/current
```

**Get Edit Result**
```
GET /projects/{project_id}/history/{edit_id}/result
```

## File Structure

```
EditmaskwithAI/
├── backend/
│   ├── app/
│   │   ├── models/          # Database models
│   │   ├── routers/         # API endpoints
│   │   ├── services/        # Business logic
│   │   ├── utils/           # Image processing utilities
│   │   ├── config.py        # Configuration
│   │   ├── database.py      # Database setup
│   │   └── main.py          # FastAPI app
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── components/      # React components
│   │   │   ├── ImageCanvas.jsx
│   │   │   ├── Controls.jsx
│   │   │   └── History.jsx
│   │   ├── utils/           # API client
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
│
├── data/                    # Persistent data (auto-created)
│   ├── ai_photo_edit.db    # SQLite database
│   └── projects/           # Project files
│
├── docker-compose.yml
├── docker-compose.dev.yml
└── README.md
```

## Data Storage

### Database (SQLite)
- **users**: User accounts
- **projects**: Project metadata
- **edits**: Edit history and metadata

### Filesystem
```
data/projects/{project_id}/
├── original.png           # Original uploaded image
├── current.png           # Current edited image
└── history/{edit_id}/
    ├── patch_in.png      # Original patch
    ├── patch_out.png     # AI-generated patch
    ├── mask.png          # Selection mask
    ├── result.png        # Final result
    └── meta.json         # Edit metadata
```

## AI Provider Configuration

### OpenAI (DALL-E)
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### Stability AI
```env
AI_PROVIDER=stability
STABILITY_API_KEY=sk-...
```

### Mock (Testing)
```env
AI_PROVIDER=mock
```
Returns the original patch unchanged - useful for testing without API costs.

## Constraints

- Only the selected region is regenerated
- No modification outside the mask
- Slight drift inside mask is acceptable
- All edits are logged and reversible
- Mode A is default (cost-efficient)
- Mode B available for better style consistency

## Non-Goals (MVP)

- No automatic anomaly detection
- No local GPU inference
- No full image regeneration
- No collaborative editing

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
- Open an issue on GitHub
- Check the API documentation at `/docs`

## Roadmap

Future enhancements:
- Multi-user authentication
- Batch processing
- Additional AI providers
- Advanced selection tools
- Real-time collaboration
- Export formats (PSD, TIFF)

---

**AI Photo Edit** - Regenerate only what you need to change.