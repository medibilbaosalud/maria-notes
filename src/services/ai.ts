// AI Service - Groq Only
// All AI operations use Groq

import { GroqService } from './groq';

export interface AIResult<T> {
    data: T;
}

export class AIService {
    private groq: GroqService;

    constructor(groqApiKey: string) {
        this.groq = new GroqService(groqApiKey);
    }

    async transcribeAudio(audioBase64: string, mimeType: string, audioBlob?: Blob): Promise<AIResult<string>> {
        // Convert base64 to blob if not provided
        if (!audioBlob) {
            const binaryString = atob(audioBase64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            audioBlob = new Blob([bytes], { type: mimeType });
        }

        console.log('[AIService] Transcribing with Groq...');
        const result = await this.groq.transcribeAudio(audioBlob);
        return { data: result };
    }

    async generateMedicalHistory(transcription: string, patientName: string = ""): Promise<AIResult<string>> {
        console.log('[AIService] Generating medical history with Groq...');
        const result = await this.groq.generateMedicalHistory(transcription, patientName);
        return { data: result };
    }

    async generateMedicalReport(transcription: string, patientName: string = ""): Promise<AIResult<string>> {
        console.log('[AIService] Generating medical report with Groq...');
        const result = await this.groq.generateMedicalReport(transcription, patientName);
        return { data: result };
    }
}
