import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import './ImageCanvas.css';

const ImageCanvas = ({
  imageUrl,
  onSelectionChange,
  selectionMode,
  advancedToolMode,
  onAdvancedToolClick,
  zoom = 1,
  onZoomChange,
  externalSelection, // { polygon: [[x,y],...], bbox: {x,y,width,height} }
}) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [currentSelection, setCurrentSelection] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isTransformMode, setIsTransformMode] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const lassoPoints = useRef([]);
  const onZoomChangeRef = useRef(onZoomChange);

  // Keep ref updated
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Initialize Fabric.js canvas
    const canvas = new fabric.Canvas(canvasRef.current, {
      selection: false,
      backgroundColor: '#2a2a2a',
    });
    fabricCanvasRef.current = canvas;

    // Handle window resize
    const handleResize = () => {
      const container = canvasRef.current?.parentElement;
      if (container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        canvas.setWidth(width);
        canvas.setHeight(height);

        // Re-center and rescale the image if it exists
        const bgImage = canvas.backgroundImage;
        if (bgImage) {
          // Allow scaling up to fill the canvas
          const scale = Math.min(
            (width - 40) / bgImage.width,
            (height - 40) / bgImage.height
          );
          bgImage.scale(scale);
          bgImage.set({
            left: (width - bgImage.width * scale) / 2,
            top: (height - bgImage.height * scale) / 2,
          });
        }
        canvas.renderAll();
      }
    };

    // Initial resize - use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      handleResize();
    });
    window.addEventListener('resize', handleResize);

    // Mouse wheel zoom
    const handleWheel = (opt) => {
      const e = opt.e;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY;
      let newZoom = canvas.getZoom();
      newZoom *= 0.999 ** delta;

      // Clamp zoom between 0.1x and 10x
      if (newZoom > 10) newZoom = 10;
      if (newZoom < 0.1) newZoom = 0.1;

      // Zoom to point under cursor
      const pointer = canvas.getPointer(e, true);
      canvas.zoomToPoint({ x: pointer.x, y: pointer.y }, newZoom);

      setCurrentZoom(newZoom);
      if (onZoomChangeRef.current) {
        onZoomChangeRef.current(newZoom);
      }
    };

    canvas.on('mouse:wheel', handleWheel);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.off('mouse:wheel', handleWheel);
      canvas.dispose();
    };
  }, []); // Empty dependency array - only run once on mount

  // Load image when URL changes
  useEffect(() => {
    if (!fabricCanvasRef.current || !imageUrl) return;

    const canvas = fabricCanvasRef.current;

    // Ensure canvas has dimensions before loading image
    if (canvas.width === 0 || canvas.height === 0) {
      const container = canvasRef.current?.parentElement;
      if (container) {
        canvas.setWidth(container.clientWidth || 800);
        canvas.setHeight(container.clientHeight || 600);
      }
    }

    // Add cache buster to force reload
    const cacheBustedUrl = `${imageUrl}?t=${Date.now()}`;

    fabric.Image.fromURL(cacheBustedUrl, (img) => {
      if (!img) {
        console.error('Failed to load image from URL:', cacheBustedUrl);
        return;
      }

      canvas.clear();

      // Scale image to fit canvas with padding
      const padding = 40;
      const availableWidth = (canvas.width || 800) - padding;
      const availableHeight = (canvas.height || 600) - padding;
      const scale = Math.min(
        availableWidth / img.width,
        availableHeight / img.height
      );

      img.scale(scale);
      img.set({
        left: ((canvas.width || 800) - img.width * scale) / 2,
        top: ((canvas.height || 600) - img.height * scale) / 2,
        selectable: false,
        evented: false,
      });

      canvas.add(img);
      canvas.sendToBack(img);
      canvas.renderAll();

      // Store image reference
      canvas.backgroundImage = img;
    }, { crossOrigin: 'anonymous' });
  }, [imageUrl]);

  // Handle advanced tool mode clicks (smart-select, color-select)
  useEffect(() => {
    if (!fabricCanvasRef.current || !advancedToolMode) return;

    const canvas = fabricCanvasRef.current;
    const bgImage = canvas.backgroundImage;

    const handleAdvancedClick = async (e) => {
      if (!bgImage || !onAdvancedToolClick) return;

      const pointer = canvas.getPointer(e.e);

      // Convert canvas coordinates to image coordinates
      const imgScale = bgImage.scaleX;
      const imgLeft = bgImage.left;
      const imgTop = bgImage.top;

      const imgX = Math.round((pointer.x - imgLeft) / imgScale);
      const imgY = Math.round((pointer.y - imgTop) / imgScale);

      // Check if click is within image bounds
      if (imgX < 0 || imgY < 0 || imgX > bgImage.width || imgY > bgImage.height) {
        return;
      }

      if (advancedToolMode === 'color-select') {
        // Get pixel color at click position
        const ctx = canvas.getContext('2d');
        const canvasX = pointer.x * canvas.getZoom();
        const canvasY = pointer.y * canvas.getZoom();

        // For color picking, we need to get the color from the image
        // Create a temporary canvas to read pixel color
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = bgImage.width;
        tempCanvas.height = bgImage.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Draw the image element to temp canvas
        const imgElement = bgImage.getElement();
        tempCtx.drawImage(imgElement, 0, 0);

        const pixelData = tempCtx.getImageData(imgX, imgY, 1, 1).data;
        const color = { r: pixelData[0], g: pixelData[1], b: pixelData[2] };

        onAdvancedToolClick(imgX, imgY, color);
      } else {
        onAdvancedToolClick(imgX, imgY, null);
      }
    };

    canvas.on('mouse:down', handleAdvancedClick);

    return () => {
      canvas.off('mouse:down', handleAdvancedClick);
    };
  }, [advancedToolMode, onAdvancedToolClick]);

  // Handle external selection (from smart-select or color-select)
  useEffect(() => {
    if (!fabricCanvasRef.current || !externalSelection?.polygon?.length) return;

    const canvas = fabricCanvasRef.current;
    const bgImage = canvas.backgroundImage;

    if (!bgImage) return;

    // Clear previous selection
    if (currentSelection) {
      canvas.remove(currentSelection);
    }

    // Convert image coordinates to canvas coordinates
    const imgScale = bgImage.scaleX;
    const imgLeft = bgImage.left;
    const imgTop = bgImage.top;

    const canvasPoints = externalSelection.polygon.map(([x, y]) => ({
      x: x * imgScale + imgLeft,
      y: y * imgScale + imgTop,
    }));

    // Create polygon selection
    const polygon = new fabric.Polygon(canvasPoints, {
      fill: 'rgba(255, 255, 255, 0.3)',
      stroke: '#00ff00',
      strokeWidth: 2,
      selectable: true,
      hasControls: true,
      hasBorders: true,
      lockRotation: false,
      cornerColor: '#00ff00',
      cornerSize: 10,
      transparentCorners: false,
      borderColor: '#00ff00',
      borderScaleFactor: 2,
    });

    canvas.add(polygon);
    canvas.setActiveObject(polygon);
    setCurrentSelection(polygon);
    lassoPoints.current = canvasPoints;

    // Notify parent of selection
    onSelectionChange({
      type: 'polygon',
      bbox: externalSelection.bbox,
      selectionData: { points: externalSelection.polygon },
    });

    canvas.renderAll();
  }, [externalSelection]);

  // Handle selection mode changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;

    // Don't set up selection handlers if in advanced tool mode
    if (advancedToolMode) return;

    // Clear previous selection when changing modes
    if (currentSelection) {
      canvas.remove(currentSelection);
      setCurrentSelection(null);
      onSelectionChange(null);
    }

    // Reset transform mode
    setIsTransformMode(false);

    // Set up event handlers based on mode
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');
    canvas.off('object:modified');

    if (selectionMode === 'rectangle') {
      setupRectangleMode(canvas);
    } else if (selectionMode === 'ellipse') {
      setupEllipseMode(canvas);
    } else if (selectionMode === 'lasso') {
      setupLassoMode(canvas);
    }
  }, [selectionMode, advancedToolMode]);

  const setupRectangleMode = (canvas) => {
    let rect, isDown, startX, startY;

    canvas.on('mouse:down', (e) => {
      // If clicking on existing selection, enable transform mode
      if (e.target && e.target === currentSelection) {
        setIsTransformMode(true);
        return;
      }

      // If in transform mode and clicking elsewhere, exit transform mode
      if (isTransformMode) {
        setIsTransformMode(false);
      }

      // Clear previous selection if exists
      if (currentSelection) {
        canvas.remove(currentSelection);
        setCurrentSelection(null);
      }

      isDown = true;
      const pointer = canvas.getPointer(e.e);
      startX = pointer.x;
      startY = pointer.y;

      rect = new fabric.Rect({
        left: startX,
        top: startY,
        width: 0,
        height: 0,
        fill: 'rgba(255, 255, 255, 0.3)',
        stroke: '#00ff00',
        strokeWidth: 2,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        lockRotation: false,
        cornerColor: '#00ff00',
        cornerSize: 10,
        transparentCorners: false,
        borderColor: '#00ff00',
        borderScaleFactor: 2,
      });

      canvas.add(rect);
      setCurrentSelection(rect);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDown || isTransformMode) return;

      const pointer = canvas.getPointer(e.e);
      const width = pointer.x - startX;
      const height = pointer.y - startY;

      rect.set({
        width: Math.abs(width),
        height: Math.abs(height),
        left: width < 0 ? pointer.x : startX,
        top: height < 0 ? pointer.y : startY,
      });

      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (isDown && !isTransformMode) {
        isDown = false;
        canvas.setActiveObject(rect);
        updateSelection(rect, 'rectangle');
      }
    });

    // Update selection when object is modified (moved, scaled, rotated)
    canvas.on('object:modified', (e) => {
      if (e.target && e.target === currentSelection) {
        updateTransformedSelection(e.target, 'rectangle');
      }
    });
  };

  const setupEllipseMode = (canvas) => {
    let ellipse, isDown, startX, startY;

    canvas.on('mouse:down', (e) => {
      // If clicking on existing selection, enable transform mode
      if (e.target && e.target === currentSelection) {
        setIsTransformMode(true);
        return;
      }

      // If in transform mode and clicking elsewhere, exit transform mode
      if (isTransformMode) {
        setIsTransformMode(false);
      }

      // Clear previous selection if exists
      if (currentSelection) {
        canvas.remove(currentSelection);
        setCurrentSelection(null);
      }

      isDown = true;
      const pointer = canvas.getPointer(e.e);
      startX = pointer.x;
      startY = pointer.y;

      ellipse = new fabric.Ellipse({
        left: startX,
        top: startY,
        rx: 0,
        ry: 0,
        fill: 'rgba(255, 255, 255, 0.3)',
        stroke: '#00ff00',
        strokeWidth: 2,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        lockRotation: false,
        cornerColor: '#00ff00',
        cornerSize: 10,
        transparentCorners: false,
        borderColor: '#00ff00',
        borderScaleFactor: 2,
      });

      canvas.add(ellipse);
      setCurrentSelection(ellipse);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDown || isTransformMode) return;

      const pointer = canvas.getPointer(e.e);
      const rx = Math.abs(pointer.x - startX) / 2;
      const ry = Math.abs(pointer.y - startY) / 2;

      ellipse.set({
        rx: rx,
        ry: ry,
        left: startX < pointer.x ? startX : pointer.x,
        top: startY < pointer.y ? startY : pointer.y,
      });

      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (isDown && !isTransformMode) {
        isDown = false;
        canvas.setActiveObject(ellipse);
        updateSelection(ellipse, 'ellipse');
      }
    });

    // Update selection when object is modified (moved, scaled, rotated)
    canvas.on('object:modified', (e) => {
      if (e.target && e.target === currentSelection) {
        updateTransformedSelection(e.target, 'ellipse');
      }
    });
  };

  const setupLassoMode = (canvas) => {
    let polygon, points = [], drawingLine;

    canvas.on('mouse:down', (e) => {
      // If clicking on existing selection, enable transform mode
      if (e.target && e.target === currentSelection) {
        setIsTransformMode(true);
        return;
      }

      // If in transform mode and clicking elsewhere, exit transform mode
      if (isTransformMode) {
        setIsTransformMode(false);
      }

      // Clear previous selection if exists
      if (currentSelection) {
        canvas.remove(currentSelection);
        setCurrentSelection(null);
      }

      setIsDrawing(true);
      const pointer = canvas.getPointer(e.e);
      points = [{ x: pointer.x, y: pointer.y }];

      // Create a temporary line for visual feedback while drawing
      drawingLine = new fabric.Polyline(points, {
        fill: 'transparent',
        stroke: '#00ff00',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });

      canvas.add(drawingLine);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDrawing || isTransformMode) return;

      const pointer = canvas.getPointer(e.e);
      points.push({ x: pointer.x, y: pointer.y });

      // Remove old line and create new one with updated points
      canvas.remove(drawingLine);
      drawingLine = new fabric.Polyline([...points], {
        fill: 'transparent',
        stroke: '#00ff00',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      canvas.add(drawingLine);
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (isDrawing && !isTransformMode && points.length > 2) {
        setIsDrawing(false);
        lassoPoints.current = [...points];

        // Remove drawing line
        canvas.remove(drawingLine);

        // Create final polygon with fill
        polygon = new fabric.Polygon(points, {
          fill: 'rgba(255, 255, 255, 0.3)',
          stroke: '#00ff00',
          strokeWidth: 2,
          selectable: true,
          hasControls: true,
          hasBorders: true,
          lockRotation: false,
          cornerColor: '#00ff00',
          cornerSize: 10,
          transparentCorners: false,
          borderColor: '#00ff00',
          borderScaleFactor: 2,
        });

        canvas.add(polygon);
        canvas.setActiveObject(polygon);
        setCurrentSelection(polygon);
        updateSelection(polygon, 'lasso');
      } else if (isDrawing) {
        setIsDrawing(false);
        canvas.remove(drawingLine);
      }
    });

    // Update selection when object is modified (moved, scaled, rotated)
    canvas.on('object:modified', (e) => {
      if (e.target && e.target === currentSelection) {
        updateTransformedSelection(e.target, 'lasso');
      }
    });
  };

  const updateSelection = (selection, type) => {
    if (!selection || !fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;
    const bgImage = canvas.backgroundImage;

    if (!bgImage) return;

    // Calculate bounding box in original image coordinates
    const imgScale = bgImage.scaleX;
    const imgLeft = bgImage.left;
    const imgTop = bgImage.top;

    let bbox, selectionData = null;

    if (type === 'rectangle') {
      bbox = {
        x: Math.round((selection.left - imgLeft) / imgScale),
        y: Math.round((selection.top - imgTop) / imgScale),
        width: Math.round(selection.width / imgScale),
        height: Math.round(selection.height / imgScale),
      };
    } else if (type === 'ellipse') {
      bbox = {
        x: Math.round((selection.left - imgLeft) / imgScale),
        y: Math.round((selection.top - imgTop) / imgScale),
        width: Math.round((selection.rx * 2) / imgScale),
        height: Math.round((selection.ry * 2) / imgScale),
      };
    } else if (type === 'lasso') {
      const bounds = selection.getBoundingRect();
      bbox = {
        x: Math.round((bounds.left - imgLeft) / imgScale),
        y: Math.round((bounds.top - imgTop) / imgScale),
        width: Math.round(bounds.width / imgScale),
        height: Math.round(bounds.height / imgScale),
      };

      // Convert lasso points to relative coordinates within bbox
      const relativePoints = lassoPoints.current.map(p => [
        Math.round((p.x - bounds.left) / imgScale),
        Math.round((p.y - bounds.top) / imgScale),
      ]);

      selectionData = { points: relativePoints };
    }

    onSelectionChange({
      type,
      bbox,
      selectionData,
    });
  };

  // Update selection after transformation (move, scale, rotate)
  const updateTransformedSelection = (selection, type) => {
    if (!selection || !fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;
    const bgImage = canvas.backgroundImage;

    if (!bgImage) return;

    const imgScale = bgImage.scaleX;
    const imgLeft = bgImage.left;
    const imgTop = bgImage.top;

    // Get the transformed bounding rect (accounts for scale and rotation)
    const bounds = selection.getBoundingRect(true);

    let bbox = {
      x: Math.round((bounds.left - imgLeft) / imgScale),
      y: Math.round((bounds.top - imgTop) / imgScale),
      width: Math.round(bounds.width / imgScale),
      height: Math.round(bounds.height / imgScale),
    };

    let selectionData = null;

    // For lasso, we need to transform the points based on the object's transformation
    if (type === 'lasso' && lassoPoints.current.length > 0) {
      const matrix = selection.calcTransformMatrix();
      const transformedPoints = lassoPoints.current.map(p => {
        const transformed = fabric.util.transformPoint(
          new fabric.Point(p.x, p.y),
          matrix
        );
        return [
          Math.round((transformed.x - bounds.left) / imgScale),
          Math.round((transformed.y - bounds.top) / imgScale),
        ];
      });
      selectionData = { points: transformedPoints };
    }

    onSelectionChange({
      type,
      bbox,
      selectionData,
    });
  };

  const clearSelection = () => {
    if (currentSelection && fabricCanvasRef.current) {
      fabricCanvasRef.current.remove(currentSelection);
      setCurrentSelection(null);
      onSelectionChange(null);
    }
  };

  const handleZoomIn = () => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    let newZoom = canvas.getZoom() * 1.2;
    if (newZoom > 10) newZoom = 10;
    canvas.setZoom(newZoom);
    setCurrentZoom(newZoom);
    if (onZoomChangeRef.current) {
      onZoomChangeRef.current(newZoom);
    }
  };

  const handleZoomOut = () => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    let newZoom = canvas.getZoom() / 1.2;
    if (newZoom < 0.1) newZoom = 0.1;
    canvas.setZoom(newZoom);
    setCurrentZoom(newZoom);
    if (onZoomChangeRef.current) {
      onZoomChangeRef.current(newZoom);
    }
  };

  const handleZoomReset = () => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    setCurrentZoom(1);
    if (onZoomChangeRef.current) {
      onZoomChangeRef.current(1);
    }
  };

  return (
    <div className="canvas-container">
      <canvas ref={canvasRef} />

      {/* Zoom controls */}
      <div className="zoom-controls">
        <button onClick={handleZoomOut} title="Zoom Out">−</button>
        <span className="zoom-level">{Math.round(currentZoom * 100)}%</span>
        <button onClick={handleZoomIn} title="Zoom In">+</button>
        <button onClick={handleZoomReset} title="Reset Zoom">⟲</button>
      </div>

      {/* Advanced tool mode indicator */}
      {advancedToolMode && (
        <div className="tool-mode-indicator">
          {advancedToolMode === 'smart-select' && 'Click on an object to select it'}
          {advancedToolMode === 'color-select' && 'Click on a color to select similar pixels'}
          {advancedToolMode === 'object-remove' && 'Click on an object to remove it'}
        </div>
      )}

      {currentSelection && !advancedToolMode && (
        <>
          <div className="selection-hint">
            Click selection to move/resize/rotate
          </div>
          <button className="clear-selection-btn" onClick={clearSelection}>
            Clear Selection
          </button>
        </>
      )}
    </div>
  );
};

export default ImageCanvas;
