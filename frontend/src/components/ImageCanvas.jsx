import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { fabric } from 'fabric';
import './ImageCanvas.css';

const ImageCanvas = forwardRef(({
  imageUrl,
  onSelectionChange,
  selectionMode,
  activeTool,
  zoom = 100,
  onSmartSelect,
  isProcessing
}, ref) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [currentSelection, setCurrentSelection] = useState(null);
  const currentSelectionRef = useRef(null);
  const lassoPoints = useRef([]);
  const isDrawingRef = useRef(false);
  const imageRef = useRef(null);
  const baseScaleRef = useRef(1);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    getCanvas: () => fabricCanvasRef.current,
    clearSelection: () => clearSelection(),
  }));

  // Update selection ref when state changes
  useEffect(() => {
    currentSelectionRef.current = currentSelection;
  }, [currentSelection]);

  // Initialize canvas
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = new fabric.Canvas(canvasRef.current, {
      selection: false,
      backgroundColor: 'transparent',
      preserveObjectStacking: true,
    });
    fabricCanvasRef.current = canvas;

    const handleResize = () => {
      const container = canvasRef.current?.parentElement;
      if (container) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        canvas.setWidth(width);
        canvas.setHeight(height);

        // Re-center image if it exists
        if (imageRef.current) {
          centerImage(canvas, imageRef.current, zoom / 100);
        }
        canvas.renderAll();
      }
    };

    handleResize();
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
      onZoomChange?.(newZoom);
    };

    canvas.on('mouse:wheel', handleWheel);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.off('mouse:wheel', handleWheel);
      canvas.dispose();
    };
  }, [onZoomChange]);

  // Center and scale image
  const centerImage = (canvas, img, zoomFactor) => {
    if (!img) return;

    const padding = 40;
    const availableWidth = canvas.width - padding;
    const availableHeight = canvas.height - padding;

    // Calculate base scale to fit
    const fitScale = Math.min(
      availableWidth / img.width,
      availableHeight / img.height
    );

    baseScaleRef.current = fitScale;
    const scale = fitScale * zoomFactor;

    img.scale(scale);
    img.set({
      left: (canvas.width - img.width * scale) / 2,
      top: (canvas.height - img.height * scale) / 2,
    });
  };

  // Apply zoom changes
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || !imageRef.current) return;

    centerImage(canvas, imageRef.current, zoom / 100);
    canvas.renderAll();
  }, [zoom]);

  // Load image when URL changes
  useEffect(() => {
    if (!fabricCanvasRef.current || !imageUrl) return;

    const canvas = fabricCanvasRef.current;
    const cacheBustedUrl = imageUrl.includes('?') ? `${imageUrl}&_t=${Date.now()}` : `${imageUrl}?t=${Date.now()}`;

    fabric.Image.fromURL(cacheBustedUrl, (img) => {
      // Remove old image
      if (imageRef.current) {
        canvas.remove(imageRef.current);
      }

      // Clear selection
      if (currentSelectionRef.current) {
        canvas.remove(currentSelectionRef.current);
        setCurrentSelection(null);
        onSelectionChange(null);
      }

      img.set({
        selectable: false,
        evented: false,
        hoverCursor: 'default',
      });

      imageRef.current = img;
      canvas.add(img);
      canvas.sendToBack(img);

      centerImage(canvas, img, zoom / 100);
      canvas.renderAll();
    }, { crossOrigin: 'anonymous' });
  }, [imageUrl]);

  // Handle tool/mode changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;

    // Remove all event handlers
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');
    canvas.off('object:modified');
    canvas.off('object:moving');
    canvas.off('object:scaling');

    // Set up handlers based on selection mode
    if (selectionMode === 'rectangle') {
      setupRectangleMode(canvas);
    } else if (selectionMode === 'ellipse') {
      setupEllipseMode(canvas);
    } else if (selectionMode === 'lasso') {
      setupLassoMode(canvas);
    } else if (selectionMode === 'smart') {
      setupSmartSelectMode(canvas);
    } else if (selectionMode === 'color') {
      setupColorSelectMode(canvas);
    } else if (activeTool === 'move') {
      setupMoveMode(canvas);
    } else if (activeTool === 'pan') {
      setupPanMode(canvas);
    }
  }, [selectionMode, activeTool, onSmartSelect]);

  const setupMoveMode = (canvas) => {
    // In move mode, allow selecting and moving selection objects
    const sel = currentSelectionRef.current;
    if (sel) {
      sel.set({ selectable: true, evented: true });
      canvas.setActiveObject(sel);
    }

    canvas.on('object:modified', (e) => {
      if (e.target && e.target === currentSelectionRef.current) {
        updateTransformedSelection(e.target);
      }
    });
  };

  const setupPanMode = (canvas) => {
    let isPanning = false;
    let lastPosX, lastPosY;

    canvas.on('mouse:down', (e) => {
      isPanning = true;
      lastPosX = e.e.clientX;
      lastPosY = e.e.clientY;
      canvas.setCursor('grabbing');
    });

    canvas.on('mouse:move', (e) => {
      if (!isPanning) return;

      const deltaX = e.e.clientX - lastPosX;
      const deltaY = e.e.clientY - lastPosY;

      canvas.relativePan({ x: deltaX, y: deltaY });

      lastPosX = e.e.clientX;
      lastPosY = e.e.clientY;
    });

    canvas.on('mouse:up', () => {
      isPanning = false;
      canvas.setCursor('grab');
    });

    canvas.setCursor('grab');
  };

  const setupSmartSelectMode = (canvas) => {
    canvas.on('mouse:down', (e) => {
      if (isProcessing) return;

      const pointer = canvas.getPointer(e.e);
      const img = imageRef.current;

      if (!img) return;

      // Convert to image coordinates
      const imgScale = img.scaleX;
      const imgLeft = img.left;
      const imgTop = img.top;

      const x = Math.round((pointer.x - imgLeft) / imgScale);
      const y = Math.round((pointer.y - imgTop) / imgScale);

      // Check if click is within image bounds
      if (x >= 0 && x < img.width && y >= 0 && y < img.height) {
        onSmartSelect?.(x, y);
      }
    });

    canvas.setCursor('crosshair');
  };

  const setupColorSelectMode = (canvas) => {
    canvas.on('mouse:down', (e) => {
      if (isProcessing) return;

      // TODO: Get pixel color at click position
      const pointer = canvas.getPointer(e.e);
      console.log('Color select at:', pointer);
    });

    canvas.setCursor('crosshair');
  };

  const setupRectangleMode = (canvas) => {
    let rect = null;
    let isDown = false;
    let startX, startY;

    canvas.on('mouse:down', (e) => {
      // Check if clicking on existing selection
      const sel = currentSelectionRef.current;
      if (e.target && e.target === sel) {
        // Allow moving/transforming
        return;
      }

      // Clear previous selection
      if (sel) {
        canvas.remove(sel);
        setCurrentSelection(null);
      }

      isDown = true;
      isDrawingRef.current = true;
      const pointer = canvas.getPointer(e.e);
      startX = pointer.x;
      startY = pointer.y;

      rect = new fabric.Rect({
        left: startX,
        top: startY,
        width: 0,
        height: 0,
        fill: 'rgba(0, 136, 255, 0.2)',
        stroke: '#0088ff',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        selectable: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: '#0088ff',
        cornerSize: 8,
        transparentCorners: false,
        borderColor: '#0088ff',
      });

      canvas.add(rect);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDown || !rect) return;

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
      if (isDown && rect && rect.width > 5 && rect.height > 5) {
        isDown = false;
        isDrawingRef.current = false;
        setCurrentSelection(rect);
        canvas.setActiveObject(rect);
        updateSelection(rect, 'rectangle');
      } else if (isDown && rect) {
        // Selection too small, remove it
        canvas.remove(rect);
        isDown = false;
        isDrawingRef.current = false;
      }
    });

    canvas.on('object:modified', (e) => {
      if (e.target === currentSelectionRef.current) {
        updateTransformedSelection(e.target);
      }
    });
  };

  const setupEllipseMode = (canvas) => {
    let ellipse = null;
    let isDown = false;
    let startX, startY;

    canvas.on('mouse:down', (e) => {
      const sel = currentSelectionRef.current;
      if (e.target && e.target === sel) {
        return;
      }

      if (sel) {
        canvas.remove(sel);
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
        fill: 'rgba(0, 136, 255, 0.2)',
        stroke: '#0088ff',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        selectable: true,
        hasControls: true,
        hasBorders: true,
        cornerColor: '#0088ff',
        cornerSize: 8,
        transparentCorners: false,
        borderColor: '#0088ff',
      });

      canvas.add(ellipse);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDown || !ellipse) return;

      const pointer = canvas.getPointer(e.e);
      const rx = Math.abs(pointer.x - startX) / 2;
      const ry = Math.abs(pointer.y - startY) / 2;

      ellipse.set({
        rx: rx,
        ry: ry,
        left: Math.min(startX, pointer.x),
        top: Math.min(startY, pointer.y),
      });

      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (isDown && ellipse && ellipse.rx > 5 && ellipse.ry > 5) {
        isDown = false;
        setCurrentSelection(ellipse);
        canvas.setActiveObject(ellipse);
        updateSelection(ellipse, 'ellipse');
      } else if (isDown && ellipse) {
        canvas.remove(ellipse);
        isDown = false;
      }
    });

    canvas.on('object:modified', (e) => {
      if (e.target === currentSelectionRef.current) {
        updateTransformedSelection(e.target);
      }
    });
  };

  const setupLassoMode = (canvas) => {
    let points = [];
    let drawingLine = null;
    let polygon = null;

    canvas.on('mouse:down', (e) => {
      const sel = currentSelectionRef.current;
      if (e.target && e.target === sel) {
        return;
      }

      if (sel) {
        canvas.remove(sel);
        setCurrentSelection(null);
      }

      isDrawingRef.current = true;
      const pointer = canvas.getPointer(e.e);
      points = [{ x: pointer.x, y: pointer.y }];

      drawingLine = new fabric.Polyline(points, {
        fill: 'transparent',
        stroke: '#0088ff',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });

      canvas.add(drawingLine);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDrawingRef.current) return;

      const pointer = canvas.getPointer(e.e);
      points.push({ x: pointer.x, y: pointer.y });

      canvas.remove(drawingLine);
      drawingLine = new fabric.Polyline([...points], {
        fill: 'transparent',
        stroke: '#0088ff',
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
      canvas.add(drawingLine);
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (isDrawingRef.current && points.length > 5) {
        isDrawingRef.current = false;
        lassoPoints.current = [...points];

        canvas.remove(drawingLine);

        polygon = new fabric.Polygon(points, {
          fill: 'rgba(0, 136, 255, 0.2)',
          stroke: '#0088ff',
          strokeWidth: 2,
          strokeDashArray: [5, 5],
          selectable: true,
          hasControls: true,
          hasBorders: true,
          cornerColor: '#0088ff',
          cornerSize: 8,
          transparentCorners: false,
          borderColor: '#0088ff',
        });

        canvas.add(polygon);
        canvas.setActiveObject(polygon);
        setCurrentSelection(polygon);
        updateSelection(polygon, 'lasso');
      } else if (isDrawingRef.current) {
        isDrawingRef.current = false;
        canvas.remove(drawingLine);
      }
    });

    canvas.on('object:modified', (e) => {
      if (e.target === currentSelectionRef.current) {
        updateTransformedSelection(e.target);
      }
    });
  };

  const updateSelection = (selection, type) => {
    if (!selection || !imageRef.current) return;

    const img = imageRef.current;
    const imgScale = img.scaleX;
    const imgLeft = img.left;
    const imgTop = img.top;

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

      const relativePoints = lassoPoints.current.map(p => [
        Math.round((p.x - imgLeft) / imgScale) - bbox.x,
        Math.round((p.y - imgTop) / imgScale) - bbox.y,
      ]);

      selectionData = { points: relativePoints };
    }

    onSelectionChange?.({
      type,
      bbox,
      selectionData,
    });
  };

  const updateTransformedSelection = (selection) => {
    if (!selection || !imageRef.current) return;

    const img = imageRef.current;
    const imgScale = img.scaleX;
    const imgLeft = img.left;
    const imgTop = img.top;

    const bounds = selection.getBoundingRect(true);

    const bbox = {
      x: Math.round((bounds.left - imgLeft) / imgScale),
      y: Math.round((bounds.top - imgTop) / imgScale),
      width: Math.round(bounds.width / imgScale),
      height: Math.round(bounds.height / imgScale),
    };

    let selectionData = null;
    const type = selection.type === 'polygon' ? 'lasso' : (selection.type === 'ellipse' ? 'ellipse' : 'rectangle');

    if (type === 'lasso' && lassoPoints.current.length > 0) {
      const matrix = selection.calcTransformMatrix();
      const transformedPoints = lassoPoints.current.map(p => {
        const transformed = fabric.util.transformPoint(
          new fabric.Point(p.x, p.y),
          matrix
        );
        return [
          Math.round((transformed.x - imgLeft) / imgScale) - bbox.x,
          Math.round((transformed.y - imgTop) / imgScale) - bbox.y,
        ];
      });
      selectionData = { points: transformedPoints };
    }

    onSelectionChange?.({
      type,
      bbox,
      selectionData,
    });
  };

  const clearSelection = () => {
    const canvas = fabricCanvasRef.current;
    const sel = currentSelectionRef.current;
    if (sel && canvas) {
      canvas.remove(sel);
      setCurrentSelection(null);
      onSelectionChange?.(null);
    }
  };

  const handleZoomIn = () => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    let newZoom = canvas.getZoom() * 1.2;
    if (newZoom > 10) newZoom = 10;
    canvas.setZoom(newZoom);
    setCurrentZoom(newZoom);
    onZoomChange?.(newZoom);
  };

  const handleZoomOut = () => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    let newZoom = canvas.getZoom() / 1.2;
    if (newZoom < 0.1) newZoom = 0.1;
    canvas.setZoom(newZoom);
    setCurrentZoom(newZoom);
    onZoomChange?.(newZoom);
  };

  const handleZoomReset = () => {
    if (!fabricCanvasRef.current) return;
    const canvas = fabricCanvasRef.current;
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    setCurrentZoom(1);
    onZoomChange?.(1);
  };

  return (
    <div className="canvas-container">
      <canvas ref={canvasRef} />
      {currentSelection && (
        <button className="clear-selection-btn" onClick={clearSelection}>
          Clear
        </button>
      )}
    </div>
  );
});

ImageCanvas.displayName = 'ImageCanvas';

export default ImageCanvas;
