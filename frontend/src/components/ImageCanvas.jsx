import React, { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import './ImageCanvas.css';

const ImageCanvas = ({ imageUrl, onSelectionChange, selectionMode }) => {
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const [currentSelection, setCurrentSelection] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
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
        canvas.setWidth(container.clientWidth);
        canvas.setHeight(Math.min(container.clientHeight, 800));
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

      // Scale image to fit canvas
      const scale = Math.min(
        canvas.width / img.width,
        canvas.height / img.height,
        1
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

    // Clear previous selection
    if (currentSelection) {
      canvas.remove(currentSelection);
      setCurrentSelection(null);
      onSelectionChange(null);
    }

    // Set up event handlers based on mode
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');

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
      });

      canvas.add(rect);
      setCurrentSelection(rect);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDown) return;

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
      isDown = false;
      updateSelection(rect, 'rectangle');
    });
  };

  const setupEllipseMode = (canvas) => {
    let ellipse, isDown, startX, startY;

    canvas.on('mouse:down', (e) => {
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
      });

      canvas.add(ellipse);
      setCurrentSelection(ellipse);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDown) return;

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
      isDown = false;
      updateSelection(ellipse, 'ellipse');
    });
  };

  const setupLassoMode = (canvas) => {
    let line, points = [];

    canvas.on('mouse:down', (e) => {
      setIsDrawing(true);
      const pointer = canvas.getPointer(e.e);
      points = [{ x: pointer.x, y: pointer.y }];

      line = new fabric.Polyline(points, {
        fill: 'rgba(255, 255, 255, 0.3)',
        stroke: '#00ff00',
        strokeWidth: 2,
        selectable: true,
      });

      canvas.add(line);
      setCurrentSelection(line);
    });

    canvas.on('mouse:move', (e) => {
      if (!isDrawing) return;

      const pointer = canvas.getPointer(e.e);
      points.push({ x: pointer.x, y: pointer.y });

      line.set({ points: points });
      canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
      setIsDrawing(false);
      lassoPoints.current = points;
      updateSelection(line, 'lasso');
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
        <button className="clear-selection-btn" onClick={clearSelection}>
          Clear Selection
        </button>
      )}
    </div>
  );
};

export default ImageCanvas;
