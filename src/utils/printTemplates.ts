import { getClinicalSpecialtyConfig } from '../clinical/specialties';

export const escapeHtml = (value: string): string => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const renderPrintableMarkdown = (value: string): string => escapeHtml(value || '')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

export const buildPrintableDocument = (params: {
    specialty: string;
    kind: 'report' | 'history';
    patientName: string;
    content: string;
    pageTitle?: string;
}) => {
    const specialty = getClinicalSpecialtyConfig(params.specialty);
    const safePatientName = escapeHtml(params.patientName || 'Paciente');
    const htmlContent = renderPrintableMarkdown(params.content);
    const titleText = escapeHtml(
        params.pageTitle
        || (params.kind === 'report' ? specialty.reportTitle : specialty.historyTitle)
    );
    const documentTitle = params.kind === 'report' ? 'INFORME' : 'HISTORIA CLINICA';

    return `
        <html>
          <head>
            <title>${titleText} - ${safePatientName}</title>
            <style>
              body { font-family: 'Georgia', serif; padding: 40px; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
              .header-container { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
              .logo-img { width: 180px; height: auto; }
              .doctor-info { text-align: right; font-family: 'Arial', sans-serif; font-size: 14px; color: #000; }
              .doctor-name { font-weight: bold; font-size: 16px; margin-bottom: 4px; }
              .report-title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 18px; margin-bottom: 30px; text-transform: uppercase; }
              .patient-info { margin-bottom: 20px; font-size: 16px; }
              .content { font-size: ${params.kind === 'report' ? '16px' : '14px'}; text-align: ${params.kind === 'report' ? 'justify' : 'left'}; }
              .footer { margin-top: 60px; text-align: center; font-size: 12px; color: #666; font-family: 'Arial', sans-serif; }
              strong { font-weight: bold; color: #000; }
            </style>
          </head>
          <body>
            <div class="header-container">
              <img src="${window.location.origin}/medibilbao_logo.png" alt="MediBilbao Salud" class="logo-img" />
              <div class="doctor-info">
                <div class="doctor-name">MediBilbao Salud</div>
                <div>Especialidad</div>
                <div>${escapeHtml(specialty.professionalLabel)}</div>
              </div>
            </div>

            <div class="report-title">${documentTitle}</div>

            <div class="patient-info">
              <strong>Paciente:</strong> ${safePatientName}
            </div>

            <div class="content">
              ${htmlContent}
            </div>

            <div class="footer">
              <div>MediSalud Bilbao Gran Via 63bis 2 dpto.6 48011 BILBAO Tel: 944329670</div>
              <div>Email: info@medibilbaosalud.com www.medibilbaosalud.com</div>
            </div>

            <script>
              window.onload = function() { window.print(); window.close(); }
            </script>
          </body>
        </html>
      `;
};
