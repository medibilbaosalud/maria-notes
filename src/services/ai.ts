// Unified AI Service - Tries Gemini first, falls back to Groq
// Returns provider info for UI notification

import { GeminiService } from './gemini';
import { GroqService } from './groq';

export type AIProvider = 'gemini' | 'groq';

export interface AIResult<T> {
    data: T;
    provider: AIProvider;
    fallbackUsed: boolean;
}

export class AIService {
    private gemini: GeminiService;
    private groq: GroqService;

    constructor(geminiApiKey: string, groqApiKey: string) {
        this.gemini = new GeminiService(geminiApiKey);
        this.groq = new GroqService(groqApiKey);
    }

    async transcribeAudio(audioBase64: string, mimeType: string, audioBlob?: Blob): Promise<AIResult<string>> {
        // Try Gemini first
        try {
            console.log('[AIService] Trying Gemini for transcription...');
            const result = await this.gemini.transcribeAudio(audioBase64, mimeType);
            return { data: result, provider: 'gemini', fallbackUsed: false };
        } catch (geminiError) {
            console.warn('[AIService] Gemini transcription failed, falling back to Groq...', geminiError);

            // Fall back to Groq (needs audio blob for FormData)
            if (!audioBlob) {
                // Convert base64 back to blob if not provided
                const binaryString = atob(audioBase64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                audioBlob = new Blob([bytes], { type: mimeType });
            }

            const result = await this.groq.transcribeAudio(audioBlob);
            return { data: result, provider: 'groq', fallbackUsed: true };
        }
    }

    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<AIResult<string>> {
        // Try Gemini first
        try {
            console.log('[AIService] Trying Gemini for medical history...');
            const result = await this.gemini.generateMedicalHistory(transcription, patientName);
            return { data: result, provider: 'gemini', fallbackUsed: false };
        } catch (geminiError) {
            console.warn('[AIService] Gemini history generation failed, falling back to Groq...', geminiError);

            const result = await this.groq.generateMedicalHistory(transcription, patientName);
            return { data: result, provider: 'groq', fallbackUsed: true };
        }
    }

    async generateMedicalReport(transcription: string, patientName: string = ""): Promise<AIResult<string>> {
        // Try Gemini first
        try {
            console.log('[AIService] Trying Gemini for medical report...');
            const result = await this.gemini.generateMedicalReport(transcription, patientName);
            return { data: result, provider: 'gemini', fallbackUsed: false };
        } catch (geminiError) {
            console.warn('[AIService] Gemini report generation failed, falling back to Groq...', geminiError);

            const result = await this.groq.generateMedicalReport(transcription, patientName);
            return { data: result, provider: 'groq', fallbackUsed: true };
        }
    }
}
