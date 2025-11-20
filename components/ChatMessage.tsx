import React from 'react';
import { AudioMessage } from '../types';

interface ChatMessageProps {
  message: AudioMessage;
  isStreaming?: boolean;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'} ${isStreaming ? 'opacity-90' : 'animate-fade-in-up'}`}>
      <div 
        className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm backdrop-blur-sm ${
          isUser 
            ? 'bg-white/10 text-white rounded-br-none' 
            : 'bg-slate-800/80 text-gray-200 rounded-bl-none border border-white/5'
        }`}
      >
        {message.text}
        {isStreaming && (
           <span className="inline-block w-1.5 h-4 ml-1 align-middle bg-current animate-pulse rounded-full opacity-70"></span>
        )}
      </div>
    </div>
  );
};

export default ChatMessage;