/**
 * Dispute PDF Generation Service
 * 
 * Generates dispute PDF documents using React-PDF and uploads to GCS
 */

import { pdf } from '@react-pdf/renderer';
import { DisputePdfTemplate } from '@/lib/pdf/disputePdfTemplate';

const MAX_FINDINGS_PER_DISPUTE = 100;
const MAX_INVOICE_NUMBER_LENGTH = 120;
const MAX_ORG_NAME_LENGTH = 200;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_LONG_TEXT_LENGTH = 4000;

interface InvoiceData {
  invoice_number: string;
  invoice_date: string;
  carrier: {
    name_normalized: string;
    name_raw?: string;
    scac?: string | null;
  };
  currency: string;
  total_amount: number;
}

interface FindingData {
  id: string;
  leak_type: string;
  rule_id: string;
  summary: string;
  reasoning: string;
  expected_amount: number | null;
  charged_amount: number | null;
  delta_amount: number;
  estimated_savings: number | null;
  evidence_json: Record<string, any> | null;
  proof_required: boolean;
  required_proof_description: string | null;
}

interface OrgData {
  id: string;
  name: string;
}

function truncateText(value: string | null | undefined, maxLength: number): string {
  if (!value) return '';
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function sanitizeFinding(finding: FindingData): FindingData {
  return {
    ...finding,
    leak_type: truncateText(finding.leak_type, MAX_SHORT_TEXT_LENGTH),
    rule_id: truncateText(finding.rule_id, MAX_SHORT_TEXT_LENGTH),
    summary: truncateText(finding.summary, MAX_LONG_TEXT_LENGTH),
    reasoning: truncateText(finding.reasoning, MAX_LONG_TEXT_LENGTH),
    required_proof_description: finding.required_proof_description
      ? truncateText(finding.required_proof_description, MAX_LONG_TEXT_LENGTH)
      : null,
  };
}

/**
 * Generates a dispute PDF document from approved findings and uploads to GCS
 * 
 * @param invoice - Invoice data
 * @param findings - Array of approved findings to include in dispute
 * @param org - Organization data
 * @returns GCS key where the PDF was uploaded
 */
export async function generateDisputePdf(
  invoice: InvoiceData,
  findings: FindingData[],
  org: OrgData
): Promise<string> {
  if (findings.length === 0) {
    throw new Error('At least one finding must be provided to generate dispute PDF');
  }
  if (findings.length > MAX_FINDINGS_PER_DISPUTE) {
    throw new Error(`A dispute PDF can include at most ${MAX_FINDINGS_PER_DISPUTE} findings`);
  }

  const safeInvoiceNumber = truncateText(invoice.invoice_number, MAX_INVOICE_NUMBER_LENGTH);
  const safeOrgName = truncateText(org.name, MAX_ORG_NAME_LENGTH);
  const safeFindings = findings.map(sanitizeFinding);

  // Generate filename
  const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const sanitizedInvoiceNumber = safeInvoiceNumber.replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `dispute-${sanitizedInvoiceNumber}-${timestamp}.pdf`;

  // Generate PDF using React-PDF
  const generatedDate = new Date().toISOString();
  const pdfDoc = (
    <DisputePdfTemplate
      invoice={{
        ...invoice,
        invoice_number: safeInvoiceNumber,
      }}
      findings={safeFindings}
      org={{
        ...org,
        name: safeOrgName,
      }}
      generatedDate={generatedDate}
    />
  );

  // Render PDF to buffer
  const pdfBlob = await pdf(pdfDoc).toBlob();
  const arrayBuffer = await pdfBlob.arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  // Upload to GCS
  // Store in disputes folder: orgs/{orgId}/disputes/{invoiceId}/{filename}
  const gcsKey = await uploadDisputePdfToGcs(pdfBuffer, filename, org.id, safeInvoiceNumber);

  return gcsKey;
}

/**
 * Uploads dispute PDF to GCS in the disputes folder structure
 * 
 * @param buffer - PDF buffer
 * @param filename - Filename for the PDF
 * @param orgId - Organization ID
 * @param invoiceNumber - Invoice number for folder structure
 * @returns GCS key/path
 */
async function uploadDisputePdfToGcs(
  buffer: Buffer,
  filename: string,
  orgId: string,
  invoiceNumber: string
): Promise<string> {
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('Missing GCS_BUCKET_NAME environment variable');
  }

  const { Storage } = await import('@google-cloud/storage');
  
  // Initialize GCS client
  const getStorageClient = () => {
    const gcpCredentialsJson = process.env.GCP_CREDENTIALS_JSON;
    if (gcpCredentialsJson) {
      try {
        const credentials = JSON.parse(Buffer.from(gcpCredentialsJson, 'base64').toString('utf8'));
        return new Storage({ credentials });
      } catch (error) {
        console.error('Failed to parse GCP_CREDENTIALS_JSON:', error);
        throw new Error('Invalid GCP_CREDENTIALS_JSON format');
      }
    }
    return new Storage();
  };

  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);

  // Generate GCS key: orgs/{orgId}/disputes/{invoiceNumber}/{timestamp}-{filename}
  const timestamp = Date.now();
  const sanitizedInvoiceNumber = invoiceNumber.replace(/[^a-zA-Z0-9.-]/g, '_');
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  const gcsKey = `orgs/${orgId}/disputes/${sanitizedInvoiceNumber}/${timestamp}-${sanitizedFilename}`;

  // Upload file
  const file = bucket.file(gcsKey);
  await file.save(buffer, {
    metadata: {
      contentType: 'application/pdf',
      metadata: {
        orgId,
        originalFilename: filename,
        uploadedAt: new Date().toISOString(),
        documentType: 'dispute',
      },
    },
  });

  return gcsKey;
}
