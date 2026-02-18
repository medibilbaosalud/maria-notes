
export class GeminigenService {
    private apiKey: string;
    private baseUrl = 'https://api.geminigen.ai/uapi/v1/generate_image';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || import.meta.env.VITE_GEMINIGEN_API_KEY || '';
        if (!this.apiKey) {
            console.warn('[GeminigenService] No API key found (VITE_GEMINIGEN_API_KEY)');
        }
    }

    async generateImage(
        prompt: string,
        options: {
            model?: string;
            aspectRatio?: string;
            style?: string;
            negativePrompt?: string;
        } = {}
    ): Promise<string> {
        if (!this.apiKey) {
            throw new Error('Geminigen API key is missing');
        }

        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model', options.model || 'nano-banana-pro');
        formData.append('aspect_ratio', options.aspectRatio || '16:9');
        if (options.style) formData.append('style', options.style);
        if (options.negativePrompt) formData.append('negative_prompt', options.negativePrompt);

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'x-api-key': this.apiKey
                },
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Geminigen API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();

            if (data.status === 3 || data.error_message) { // 3: Failed
                throw new Error(`Geminigen generation failed: ${data.error_message || 'Unknown error'}`);
            }

            if (data.generate_result) {
                return data.generate_result;
            }

            throw new Error('Geminigen response missing generate_result');
        } catch (error) {
            // Rethrow to be caught by the fallback mechanism
            throw error;
        }
    }
}
