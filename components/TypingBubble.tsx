import React from 'react';

const TypingBubble: React.FC = () => {
  return (
    <div className="flex w-full mb-4 justify-start animate-fade-in">
      <div className="bg-slate-800/80 border border-white/5 px-4 py-3 rounded-2xl rounded-bl-none backdrop-blur-sm flex items-center gap-1.5 h-[46px] shadow-sm">
        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
      </div>
    </div>
  );
};

export default TypingBubble;