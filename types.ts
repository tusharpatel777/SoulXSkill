export enum PersonaMode {
  GIRLFRIEND = 'GIRLFRIEND',
  INTERVIEWER = 'INTERVIEWER',
}

export interface PersonaConfig {
  id: PersonaMode;
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
  voiceName: string;
  themeColor: string;
  icon: string; // Emoji or Lucide icon name concept
}

export interface AudioMessage {
  role: 'user' | 'model';
  text?: string;
}
