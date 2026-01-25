import React, { useEffect, useRef, useState, useCallback } from 'react';
import { fabric } from 'fabric';
import './ImageCanvas.css';

const ImageCanvas = ({ imageUrl, onSelectionChange, selectionMode }) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [currentSelection, setCurrentSelection] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isTransformMode, setIsTransformMode] = useState(false);
  const lassoPoints = useRef([]);

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
          const scale = Math.min(
            (width - 40) / bgImage.width,
            (height - 40) / bgImage.height,
            1
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

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.dispose();
    };
  }, []);

  // Load image when URL changes
  useEffect(() => {
    if (!fabricCanvasRef.current || !imageUrl) return;

    const canvas = fabricCanvasRef.current;

    // Add cache buster to force reload
    const cacheBustedUrl = `${imageUrl}?t=${Date.now()}`;

    fabric.Image.fromURL(cacheBustedUrl, (img) => {
      canvas.clear();

      // Scale image to fit canvas with padding
      const padding = 40;
      const availableWidth = canvas.width - padding;
      const availableHeight = canvas.height - padding;
      const scale = Math.min(
        availableWidth / img.width,
        availableHeight / img.height
      );

      img.scale(scale);
      img.set({
        left: (canvas.width - img.width * scale) / 2,
        top: (canvas.height - img.height * scale) / 2,
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

  // Handle selection mode changes
  useEffect(() => {
    if (!fabricCanvasRef.current) return;

    const canvas = fabricCanvasRef.current;

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
  }, [selectionMode]);

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
    let line, points = [];

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

      line = new fabric.Polyline(points, {
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

      canvas.add(line);
      setCurrentSelection(line);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDrawing || isTransformMode) return;

      const pointer = canvas.getPointer(e.e);
      points.push({ x: pointer.x, y: pointer.y });

      line.set({ points: points });
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      if (isDrawing && !isTransformMode) {
        setIsDrawing(false);
        lassoPoints.current = points;
        canvas.setActiveObject(line);
        updateSelection(line, 'lasso');
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

  return (
    <div className="canvas-container">
      <canvas ref={canvasRef} />
      {currentSelection && (
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
