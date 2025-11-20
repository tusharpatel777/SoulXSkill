import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  colorMode: 'rose' | 'blue';
}

const Visualizer: React.FC<VisualizerProps> = ({ analyser, isActive, colorMode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const render = () => {
      animationId = requestAnimationFrame(render);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Center coordinates
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radius = 80; // Base radius of the orb
      
      // Calculate average volume for pulsing effect
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      const scale = 1 + (average / 256) * 0.5;

      // Draw glowing core
      ctx.beginPath();
      ctx.arc(cx, cy, radius * (isActive ? scale : 1), 0, 2 * Math.PI);
      
      const gradient = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.5);
      if (colorMode === 'rose') {
        gradient.addColorStop(0, 'rgba(251, 113, 133, 0.9)'); // Rose-400
        gradient.addColorStop(1, 'rgba(225, 29, 72, 0)'); // Transparent
      } else {
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.9)'); // Indigo-500
        gradient.addColorStop(1, 'rgba(79, 70, 229, 0)'); // Transparent
      }
      
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw frequency bars in a circle
      if (isActive) {
        const barCount = 60;
        const step = Math.floor(bufferLength / barCount);
        
        ctx.strokeStyle = colorMode === 'rose' ? '#fda4af' : '#a5b4fc'; // Lighter accent
        ctx.lineWidth = 2;

        for (let i = 0; i < barCount; i++) {
          const value = dataArray[i * step];
          const percent = value / 256;
          const barHeight = radius * 0.5 * percent * scale;
          const angle = (i / barCount) * Math.PI * 2;

          const x1 = cx + Math.cos(angle) * (radius * scale);
          const y1 = cy + Math.sin(angle) * (radius * scale);
          const x2 = cx + Math.cos(angle) * (radius * scale + barHeight);
          const y2 = cy + Math.sin(angle) * (radius * scale + barHeight);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser, isActive, colorMode]);

  return (
    <canvas 
      ref={canvasRef} 
      width={400} 
      height={400} 
      className="w-full max-w-[400px] h-auto aspect-square"
    />
  );
};

export default Visualizer;
