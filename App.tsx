import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { PERSONAS, MODEL_NAME } from './constants';
import { PersonaMode, AudioMessage } from './types';
import { createPCM16Blob, decode, decodeAudioData } from './services/audioUtils';
import Visualizer from './components/Visualizer';
import ChatMessage from './components/ChatMessage';
import TypingBubble from './components/TypingBubble';
import { Mic, MicOff, Phone, PhoneOff, ArrowRightLeft, Briefcase, Sparkles, Trash2 } from 'lucide-react';

// Types for the component state
type ConnectionState = 'disconnected' | 'connecting' | 'connected';

const App: React.FC = () => {
  // State
  const [mode, setMode] = useState<PersonaMode | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [messages, setMessages] = useState<AudioMessage[]>([]);
  const [streamingUserText, setStreamingUserText] = useState<string>("");
  const [streamingModelText, setStreamingModelText] = useState<string>("");
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const currentInputTranscriptionRef = useRef<string>('');
  const currentOutputTranscriptionRef = useRef<string>('');
  const streamRef = useRef<MediaStream | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);

  // Select default persona if mode is null
  const currentPersona = mode ? PERSONAS[mode] : null;

  // Load History
  useEffect(() => {
    if (!mode) return;
    const key = `chat_history_${mode}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
        setMessages([]);
      }
    } else {
      setMessages([]);
    }
    setStreamingUserText("");
    setStreamingModelText("");
  }, [mode]);

  // Save History
  useEffect(() => {
    if (!mode) return;
    const key = `chat_history_${mode}`;
    if (messages.length > 0) {
      localStorage.setItem(key, JSON.stringify(messages));
    }
  }, [messages, mode]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollAnchorRef.current) {
      scrollAnchorRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingUserText, streamingModelText]);

  const clearHistory = () => {
    if (!mode) return;
    if (window.confirm("Are you sure you want to clear the conversation history?")) {
      setMessages([]);
      localStorage.removeItem(`chat_history_${mode}`);
    }
  };

  const hasHistory = (modeId: PersonaMode) => {
    const saved = localStorage.getItem(`chat_history_${modeId}`);
    return saved && JSON.parse(saved).length > 0;
  };

  // Cleanup function to stop all audio and close connections
  const disconnect = async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      session.close();
      sessionPromiseRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    if (inputContextRef.current) {
        inputContextRef.current.close();
        inputContextRef.current = null;
    }

    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();

    setConnectionState('disconnected');
    setAnalyser(null);
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';
    setStreamingUserText("");
    setStreamingModelText("");
  };

  const handleModeSelect = (selectedMode: PersonaMode) => {
    setMessages([]); // Clear previous messages to prevent flash
    setMode(selectedMode);
  };

  const handleSwitchPersona = () => {
    disconnect();
    setMode(null);
    setMessages([]); // Ensure state is clean
  };

  const connect = async () => {
    if (!currentPersona) return;
    setError(null);
    setConnectionState('connecting');

    try {
      // const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

      // 1. Setup Audio Output Context
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      
      // Setup Visualizer Analyser
      const analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;
      setAnalyser(analyserNode);

      const gainNode = audioCtx.createGain();
      gainNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);

      // 2. Setup Audio Input
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputContextRef.current = inputCtx;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. Initialize Gemini Live Session
      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: currentPersona.voiceName } }
          },
          systemInstruction: currentPersona.systemInstruction,
          inputAudioTranscription: {}, // Enable transcription for user input
          outputAudioTranscription: {}, // Enable transcription for model output
        },
        callbacks: {
          onopen: () => {
            console.log("Session opened");
            setConnectionState('connected');

            // Start processing input audio
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (isMicMuted) return; // Simple mute logic at source
              
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPCM16Blob(inputData);
              
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle Transcription
            if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                currentOutputTranscriptionRef.current += text;
                setStreamingModelText(currentOutputTranscriptionRef.current);
            } else if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                currentInputTranscriptionRef.current += text;
                setStreamingUserText(currentInputTranscriptionRef.current);
            }

            if (message.serverContent?.turnComplete) {
                const userText = currentInputTranscriptionRef.current;
                const modelText = currentOutputTranscriptionRef.current;
                
                // Clear streaming buffers immediately to prevent flash
                setStreamingUserText("");
                setStreamingModelText("");
                currentInputTranscriptionRef.current = '';
                currentOutputTranscriptionRef.current = '';

                if (userText.trim() || modelText.trim()) {
                    setMessages(prev => {
                        const newMessages = [...prev];
                        if (userText.trim()) newMessages.push({ role: 'user', text: userText });
                        if (modelText.trim()) newMessages.push({ role: 'model', text: modelText });
                        return newMessages;
                    });
                }
            }

            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
              const audioCtx = audioContextRef.current;
              if (!audioCtx) return;

              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioCtx.currentTime);
              
              const audioBuffer = await decodeAudioData(
                decode(base64Audio),
                audioCtx,
                24000,
                1
              );

              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(gainNode);
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
                sourcesRef.current.forEach(s => s.stop());
                sourcesRef.current.clear();
                nextStartTimeRef.current = 0;
                
                // Reset only output transcription on interrupt (user might have kept talking)
                currentOutputTranscriptionRef.current = '';
                setStreamingModelText("");
            }
          },
          onclose: () => {
            console.log("Session closed");
            disconnect();
          },
          onerror: (err) => {
            console.error("Session error", err);
            setError("Connection error. Please try again.");
            disconnect();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e: any) {
      console.error(e);
      setError(e.message || "Failed to connect");
      setConnectionState('disconnected');
    }
  };

  const toggleMute = () => setIsMicMuted(!isMicMuted);

  // -- Renders --

  // 1. Persona Selection Screen
  if (!mode) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center py-12 px-4 sm:justify-center overflow-y-auto animate-fade-in">
        <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-4">
                <Sparkles className="text-pink-400 w-8 h-8" />
                <h1 className="text-4xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
                Soul & Skills
                </h1>
                <Briefcase className="text-indigo-400 w-8 h-8" />
            </div>
            <p className="text-slate-400 text-lg max-w-lg mx-auto leading-relaxed">
            Your AI companion for every moment. Relax with a caring friend or prepare for your next big career move.
            </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 w-full max-w-5xl px-4">
          {/* Girlfriend Mode Card */}
          <button 
            onClick={() => handleModeSelect(PersonaMode.GIRLFRIEND)}
            className="group relative bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-pink-500/50 rounded-[2rem] p-8 transition-all duration-300 hover:shadow-[0_0_50px_-12px_rgba(244,63,94,0.4)] text-left flex flex-col h-full overflow-hidden"
          >
            {/* Background Decor */}
            <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-pink-500/10 rounded-full blur-3xl group-hover:bg-pink-500/20 transition-all"></div>
            
            {hasHistory(PersonaMode.GIRLFRIEND) && (
              <div className="absolute top-6 right-6 bg-pink-500/20 text-pink-300 text-xs font-bold px-3 py-1.5 rounded-full border border-pink-500/30 flex items-center gap-2 shadow-sm z-10">
                 Resume <span className="w-2 h-2 bg-pink-400 rounded-full animate-pulse"></span>
              </div>
            )}

            <div className="mb-6 relative z-10">
                <span className="text-pink-400 font-bold tracking-widest text-sm uppercase mb-2 block">Soul Mode</span>
                <div className="w-20 h-20 bg-gradient-to-br from-pink-500 to-rose-600 rounded-2xl flex items-center justify-center shadow-lg shadow-pink-900/50 text-4xl">
                {PERSONAS.GIRLFRIEND.icon}
                </div>
            </div>
            
            <div className="relative z-10 mt-auto">
                <h3 className="text-3xl font-bold text-white mb-2">Eve</h3>
                <p className="text-pink-200/80 font-medium text-lg mb-4">The Caring Companion</p>
                <p className="text-slate-400 leading-relaxed">
                Unwind and talk about your day. Eve is here to listen, comfort, and care for you with a gentle voice.
                </p>
            </div>
          </button>

          {/* Interviewer Mode Card */}
          <button 
            onClick={() => handleModeSelect(PersonaMode.INTERVIEWER)}
            className="group relative bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-indigo-500/50 rounded-[2rem] p-8 transition-all duration-300 hover:shadow-[0_0_50px_-12px_rgba(99,102,241,0.4)] text-left flex flex-col h-full overflow-hidden"
          >
            {/* Background Decor */}
            <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all"></div>

            {hasHistory(PersonaMode.INTERVIEWER) && (
              <div className="absolute top-6 right-6 bg-indigo-500/20 text-indigo-300 text-xs font-bold px-3 py-1.5 rounded-full border border-indigo-500/30 flex items-center gap-2 shadow-sm z-10">
                 Resume <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span>
              </div>
            )}

            <div className="mb-6 relative z-10">
                <span className="text-indigo-400 font-bold tracking-widest text-sm uppercase mb-2 block">Skills Mode</span>
                <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/50 text-4xl">
                {PERSONAS.INTERVIEWER.icon}
                </div>
            </div>
            
            <div className="relative z-10 mt-auto">
                <h3 className="text-3xl font-bold text-white mb-2">Alex</h3>
                <p className="text-indigo-200/80 font-medium text-lg mb-4">SDE Interview Prep</p>
                <p className="text-slate-400 leading-relaxed">
                Prepare for your dream job. A rigorous technical interviewer focused on algorithms, system design, and core CS concepts.
                </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // 2. Active Chat Screen
  return (
    <div className="min-h-screen bg-slate-900 flex flex-col relative overflow-hidden">
      {/* Background Ambience */}
      <div className={`absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-20 bg-gradient-to-r ${currentPersona?.themeColor}`}></div>
      <div className={`absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] opacity-20 bg-gradient-to-l ${currentPersona?.themeColor}`}></div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 py-6">
        <button 
          onClick={handleSwitchPersona}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors bg-slate-800/50 hover:bg-slate-800 px-4 py-2 rounded-full backdrop-blur-sm border border-white/5 group"
          title="Stop & Switch Mode"
        >
          <ArrowRightLeft size={18} className="group-hover:-scale-x-100 transition-transform duration-300" />
          <span className="text-sm font-medium">Switch Mode</span>
        </button>

        <div className="flex flex-col items-center">
           <span className="text-lg font-bold tracking-wide flex items-center gap-2">
             <span className="text-2xl">{currentPersona?.icon}</span>
             {currentPersona?.name}
           </span>
           <span className={`text-xs px-2 py-0.5 rounded-full mt-1 font-medium flex items-center gap-1.5 ${connectionState === 'connected' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/20' : 'bg-slate-700 text-slate-400'}`}>
             {connectionState === 'connected' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>}
             {connectionState === 'connected' ? 'Live' : connectionState === 'connecting' ? 'Connecting...' : 'Offline'}
           </span>
        </div>

        <button 
          onClick={clearHistory}
          className="p-2 text-slate-400 hover:text-red-400 transition-colors hover:bg-red-500/10 rounded-lg"
          title="Clear History"
        >
          <Trash2 size={20} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 relative z-10 flex flex-col items-center w-full max-w-4xl mx-auto px-4">
        
        {/* Visualizer Container */}
        <div className="flex-1 w-full flex items-center justify-center py-8 min-h-[300px]">
          <div className="relative">
            {/* Visualizer */}
            <Visualizer 
              analyser={analyser} 
              isActive={connectionState === 'connected'} 
              colorMode={mode === PersonaMode.GIRLFRIEND ? 'rose' : 'blue'}
            />
            
            {/* Connecting Loader */}
            {connectionState === 'connecting' && (
              <div className="absolute inset-0 flex items-center justify-center">
                 <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-white opacity-50"></div>
              </div>
            )}
          </div>
        </div>

        {/* Transcription Area */}
        <div className="w-full h-48 overflow-y-auto mb-8 px-4 scroll-smooth mask-image-gradient">
           {messages.length === 0 && !streamingUserText && !streamingModelText && connectionState === 'connected' && (
             <div className="text-center text-slate-500 text-sm italic mt-10 animate-pulse">
               Start speaking to {currentPersona?.name}...
             </div>
           )}
           
           {messages.map((msg, idx) => (
             <ChatMessage key={idx} message={msg} />
           ))}
           
           {/* Streaming Messages (Typing Indicators) */}
           {streamingUserText && (
             <ChatMessage message={{ role: 'user', text: streamingUserText }} isStreaming={true} />
           )}
           {streamingModelText && (
             <ChatMessage message={{ role: 'model', text: streamingModelText }} isStreaming={true} />
           )}
           {!streamingModelText && connectionState === 'connected' && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
             /* Show dots if user just finished and we are waiting for model text */
             <TypingBubble />
           )}

           <div ref={scrollAnchorRef}></div>
        </div>

        {/* Controls */}
        <div className="w-full max-w-md flex items-center justify-center mb-12">
           {connectionState === 'disconnected' ? (
             <div className="flex flex-col items-center gap-4 w-full">
                <button 
                  onClick={connect}
                  className={`flex items-center justify-center gap-3 w-full max-w-[280px] py-4 rounded-full text-white font-bold shadow-lg hover:scale-105 transition-all bg-gradient-to-r ${currentPersona?.themeColor} shadow-${mode === PersonaMode.GIRLFRIEND ? 'rose' : 'indigo'}-500/30`}
                >
                  <Phone size={24} />
                  <span>Start Conversation</span>
                </button>
                
                <button 
                  onClick={handleSwitchPersona}
                  className="text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-2 text-sm py-2 group"
                >
                  <ArrowRightLeft size={16} className="group-hover:text-white transition-colors" />
                  <span>Change Persona</span>
                </button>
             </div>
           ) : (
             <div className="flex items-center gap-6">
               <button 
                onClick={toggleMute}
                className={`p-5 rounded-full transition-all border ${isMicMuted ? 'bg-red-500/20 border-red-500/50 text-red-500 hover:bg-red-500/30' : 'bg-slate-800 border-slate-700 text-white hover:bg-slate-700'}`}
               >
                 {isMicMuted ? <MicOff size={24} /> : <Mic size={24} />}
               </button>

               <button 
                onClick={disconnect}
                className="p-5 rounded-full bg-red-500 text-white hover:bg-red-600 hover:scale-105 transition-all shadow-lg shadow-red-500/30"
               >
                 <PhoneOff size={24} />
               </button>
             </div>
           )}
        </div>

        {error && (
          <div className="absolute bottom-24 bg-red-500/10 border border-red-500/50 text-red-200 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

      </main>
    </div>
  );
};

export default App;