from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import Optional
from PIL import Image
from io import BytesIO
import numpy as np
import json

from app.database import get_db
from app.models.project import Project
from app.schemas import StatusResponse

router = APIRouter(prefix="/tools", tags=["tools"])


@router.post("/remove-background")
async def remove_background(
    project_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    """
    Remove background from an image using rembg.

    Either provide project_id to use current project image,
    or upload a file directly.

    Returns PNG with transparent background.
    """
    try:
        from rembg import remove
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="rembg not installed. Run: pip install rembg"
        )

    # Get image bytes
    if file:
        image_bytes = await file.read()
    elif project_id:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        from app.services.edit_service import EditService
        edit_service = EditService()
        image_path = edit_service.get_current_image_path(project_id)

        with open(image_path, 'rb') as f:
            image_bytes = f.read()
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either project_id or file"
        )

    # Remove background
    result_bytes = remove(image_bytes)

    return Response(
        content=result_bytes,
        media_type="image/png",
        headers={"Content-Disposition": "inline; filename=no-background.png"}
    )


@router.post("/remove-background-to-layer")
async def remove_background_to_layer(
    project_id: int = Form(...),
    db: Session = Depends(get_db)
):
    """
    Remove background and save as a new layer in the project.
    Returns layer info that can be added to frontend layer system.
    """
    try:
        from rembg import remove
    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="rembg not installed. Run: pip install rembg"
        )

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.edit_service import EditService
    from pathlib import Path

    edit_service = EditService()
    image_path = edit_service.get_current_image_path(project_id)

    with open(image_path, 'rb') as f:
        image_bytes = f.read()

    # Remove background
    result_bytes = remove(image_bytes)

    # Save as layer file
    project_dir = edit_service.get_project_dir(project_id)
    layers_dir = project_dir / 'layers'
    layers_dir.mkdir(exist_ok=True)

    # Find next layer number
    existing_layers = list(layers_dir.glob('layer_*.png'))
    layer_num = len(existing_layers) + 1
    layer_path = layers_dir / f'layer_{layer_num}.png'

    with open(layer_path, 'wb') as f:
        f.write(result_bytes)

    # Get dimensions
    img = Image.open(BytesIO(result_bytes))

    return {
        "status": "success",
        "layer": {
            "id": layer_num,
            "name": f"No Background {layer_num}",
            "path": str(layer_path),
            "width": img.width,
            "height": img.height,
            "type": "background_removed"
        }
    }


@router.post("/smart-select")
async def smart_select(
    project_id: int = Form(...),
    point_x: int = Form(...),
    point_y: int = Form(...),
    db: Session = Depends(get_db)
):
    """
    Use SAM (Segment Anything) to select object at given point.
    Returns mask for the selected object.

    Note: Requires SAM model to be downloaded.
    Falls back to simple flood-fill selection if SAM unavailable.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.edit_service import EditService
    edit_service = EditService()
    image_path = edit_service.get_current_image_path(project_id)

    img = Image.open(image_path).convert('RGB')
    img_array = np.array(img)

    # Try SAM first, fall back to flood fill
    try:
        mask = await _sam_select(img_array, point_x, point_y)
    except Exception as e:
        print(f"SAM not available, using flood fill: {e}")
        mask = _flood_fill_select(img_array, point_x, point_y)

    # Convert mask to PNG
    mask_img = Image.fromarray((mask * 255).astype(np.uint8), mode='L')

    buffer = BytesIO()
    mask_img.save(buffer, format='PNG')

    return Response(
        content=buffer.getvalue(),
        media_type="image/png"
    )


async def _sam_select(img_array: np.ndarray, x: int, y: int) -> np.ndarray:
    """Use Segment Anything Model for selection"""
    # This would require SAM to be installed and model downloaded
    # For now, raise to fall back to flood fill
    raise NotImplementedError("SAM integration pending")


def _flood_fill_select(img_array: np.ndarray, x: int, y: int, tolerance: int = 32) -> np.ndarray:
    """Simple flood-fill based selection with color tolerance"""
    import cv2

    h, w = img_array.shape[:2]

    # Ensure point is within bounds
    x = max(0, min(x, w - 1))
    y = max(0, min(y, h - 1))

    # Create mask for flood fill (needs to be 2 pixels larger)
    mask = np.zeros((h + 2, w + 2), np.uint8)

    # Flood fill
    cv2.floodFill(
        img_array.copy(),
        mask,
        (x, y),
        (255, 255, 255),
        (tolerance, tolerance, tolerance),
        (tolerance, tolerance, tolerance),
        cv2.FLOODFILL_MASK_ONLY
    )

    # Extract the actual mask (remove padding)
    return mask[1:-1, 1:-1]


@router.post("/color-select")
async def color_select(
    project_id: int = Form(...),
    color_r: int = Form(...),
    color_g: int = Form(...),
    color_b: int = Form(...),
    tolerance: int = Form(30),
    db: Session = Depends(get_db)
):
    """
    Select all pixels similar to the given color.
    Returns a mask of selected areas.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.edit_service import EditService
    edit_service = EditService()
    image_path = edit_service.get_current_image_path(project_id)

    img = Image.open(image_path).convert('RGB')
    img_array = np.array(img)

    # Target color
    target = np.array([color_r, color_g, color_b])

    # Calculate color distance
    diff = np.abs(img_array.astype(np.int16) - target.astype(np.int16))
    distance = np.sum(diff, axis=2)

    # Create mask where distance is within tolerance
    mask = (distance <= tolerance * 3).astype(np.uint8) * 255

    # Convert to PNG
    mask_img = Image.fromarray(mask, mode='L')

    buffer = BytesIO()
    mask_img.save(buffer, format='PNG')

    return Response(
        content=buffer.getvalue(),
        media_type="image/png"
    )


@router.post("/extract-object")
async def extract_object(
    project_id: int = Form(...),
    mask: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Extract object using provided mask.
    Returns PNG with transparent background containing only the masked area.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.edit_service import EditService
    edit_service = EditService()
    image_path = edit_service.get_current_image_path(project_id)

    # Load image and mask
    img = Image.open(image_path).convert('RGBA')
    mask_bytes = await mask.read()
    mask_img = Image.open(BytesIO(mask_bytes)).convert('L')

    # Resize mask if needed
    if mask_img.size != img.size:
        mask_img = mask_img.resize(img.size, Image.Resampling.LANCZOS)

    # Apply mask as alpha channel
    img_array = np.array(img)
    mask_array = np.array(mask_img)

    # Set alpha channel based on mask
    img_array[:, :, 3] = mask_array

    result = Image.fromarray(img_array, mode='RGBA')

    buffer = BytesIO()
    result.save(buffer, format='PNG')

    return Response(
        content=buffer.getvalue(),
        media_type="image/png"
    )


@router.get("/layers/{project_id}")
async def list_layers(
    project_id: int,
    db: Session = Depends(get_db)
):
    """List all layers for a project"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.edit_service import EditService
    from pathlib import Path

    edit_service = EditService()
    project_dir = edit_service.get_project_dir(project_id)
    layers_dir = project_dir / 'layers'

    if not layers_dir.exists():
        return {"layers": []}

    layers = []
    for layer_file in sorted(layers_dir.glob('layer_*.png')):
        img = Image.open(layer_file)
        layer_num = int(layer_file.stem.split('_')[1])
        layers.append({
            "id": layer_num,
            "name": f"Layer {layer_num}",
            "path": str(layer_file),
            "width": img.width,
            "height": img.height
        })

    return {"layers": layers}


@router.post("/flatten-layers")
async def flatten_layers(
    project_id: int = Form(...),
    layer_order: str = Form(...),  # JSON array of layer IDs in order
    db: Session = Depends(get_db)
):
    """
    Flatten all layers into a single image and save as current.
    layer_order is a JSON array like [1, 2, 3] from bottom to top.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    from app.services.edit_service import EditService
    from pathlib import Path

    edit_service = EditService()
    project_dir = edit_service.get_project_dir(project_id)
    layers_dir = project_dir / 'layers'

    order = json.loads(layer_order)

    # Start with original image as base
    base_path = edit_service.get_current_image_path(project_id)
    result = Image.open(base_path).convert('RGBA')

    # Composite layers in order
    for layer_id in order:
        layer_path = layers_dir / f'layer_{layer_id}.png'
        if layer_path.exists():
            layer = Image.open(layer_path).convert('RGBA')
            # Resize if needed
            if layer.size != result.size:
                layer = layer.resize(result.size, Image.Resampling.LANCZOS)
            result = Image.alpha_composite(result, layer)

    # Save as current
    result.save(base_path, 'PNG')

    return StatusResponse(
        status="success",
        message="Layers flattened successfully"
    )
