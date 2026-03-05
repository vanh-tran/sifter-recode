/**
 * Dispute PDF Template Component
 * 
 * React-PDF component for generating dispute documents
 */

import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const MAX_PROOF_TEXT_LENGTH = 4000;

// Define styles
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 11,
    lineHeight: 1.5,
  },
  header: {
    marginBottom: 30,
    paddingBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: '#1a365d',
    borderBottomStyle: 'solid',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a365d',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: '#4a5568',
    marginTop: 5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 10,
    marginTop: 15,
  },
  invoiceInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  invoiceInfoLabel: {
    fontWeight: 'bold',
    color: '#4a5568',
    width: '30%',
  },
  invoiceInfoValue: {
    color: '#2d3748',
    width: '70%',
  },
  finding: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: '#f7fafc',
    borderLeftWidth: 4,
    borderLeftColor: '#e53e3e',
    borderLeftStyle: 'solid',
  },
  findingHeader: {
    marginBottom: 10,
  },
  findingTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  findingSubtitle: {
    fontSize: 10,
    color: '#718096',
    marginBottom: 8,
  },
  findingContent: {
    marginTop: 8,
  },
  findingParagraph: {
    marginBottom: 8,
    color: '#4a5568',
    textAlign: 'justify',
  },
  priceBreakdown: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'solid',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
    paddingVertical: 3,
  },
  priceLabel: {
    color: '#4a5568',
    fontWeight: '500',
  },
  priceValue: {
    color: '#2d3748',
    fontWeight: 'bold',
  },
  priceDelta: {
    color: '#e53e3e',
    fontWeight: 'bold',
  },
  proofSection: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#edf2f7',
    borderWidth: 1,
    borderColor: '#cbd5e0',
    borderStyle: 'solid',
  },
  proofTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#2d3748',
    marginBottom: 6,
  },
  proofText: {
    fontSize: 10,
    color: '#4a5568',
    lineHeight: 1.4,
  },
  footer: {
    marginTop: 30,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    borderTopStyle: 'solid',
    fontSize: 9,
    color: '#718096',
    textAlign: 'center',
  },
  pageNumber: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 9,
    color: '#718096',
  },
});

interface DisputePdfTemplateProps {
  invoice: {
    invoice_number: string;
    invoice_date: string;
    carrier: {
      name_normalized: string;
      name_raw?: string;
      scac?: string | null;
    };
    currency: string;
    total_amount: number;
  };
  findings: Array<{
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
  }>;
  org: {
    name: string;
  };
  generatedDate: string;
}

/**
 * Formats a leak type (e.g., "duplicate_invoice") into a human-readable format
 */
function formatLeakType(leakType: string): string {
  return leakType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Formats currency amount
 */
function formatCurrency(amount: number | null, currency: string): string {
  if (amount === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount);
}

/**
 * Formats date to readable format
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function asBoundedText(value: unknown): string {
  if (typeof value === 'string') {
    return truncateText(value, MAX_PROOF_TEXT_LENGTH);
  }
  try {
    return truncateText(JSON.stringify(value), MAX_PROOF_TEXT_LENGTH);
  } catch {
    return 'Supporting evidence is available but could not be rendered.';
  }
}

/**
 * Extracts proof text from finding evidence
 */
function getProofText(finding: DisputePdfTemplateProps['findings'][0]): string | null {
  // If there's a required proof description, use that
  if (finding.required_proof_description) {
    return truncateText(finding.required_proof_description, MAX_PROOF_TEXT_LENGTH);
  }

  // Try to extract proof from evidence_json
  if (finding.evidence_json) {
    // Common patterns in evidence_json
    if (finding.evidence_json.proof) {
      return asBoundedText(finding.evidence_json.proof);
    }

    if (finding.evidence_json.proof_description) {
      return asBoundedText(finding.evidence_json.proof_description);
    }

    // If evidence_json has text fields, try to construct proof
    if (finding.evidence_json.source) {
      return asBoundedText(`Source: ${finding.evidence_json.source}`);
    }
  }

  return null;
}

export function DisputePdfTemplate({
  invoice,
  findings,
  org,
  generatedDate,
}: DisputePdfTemplateProps) {
  const totalSavings = findings.reduce(
    (sum, f) => sum + (f.estimated_savings || 0),
    0
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>DISPUTE LETTER</Text>
          <Text style={styles.subtitle}>
            Invoice Discrepancies - {org.name}
          </Text>
          <Text style={styles.subtitle}>
            Generated: {formatDate(generatedDate)}
          </Text>
        </View>

        {/* Invoice Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Invoice Information</Text>
          <View style={styles.invoiceInfo}>
            <Text style={styles.invoiceInfoLabel}>Invoice Number:</Text>
            <Text style={styles.invoiceInfoValue}>{invoice.invoice_number}</Text>
          </View>
          <View style={styles.invoiceInfo}>
            <Text style={styles.invoiceInfoLabel}>Invoice Date:</Text>
            <Text style={styles.invoiceInfoValue}>
              {formatDate(invoice.invoice_date)}
            </Text>
          </View>
          <View style={styles.invoiceInfo}>
            <Text style={styles.invoiceInfoLabel}>Carrier:</Text>
            <Text style={styles.invoiceInfoValue}>
              {invoice.carrier.name_normalized}
              {invoice.carrier.scac ? ` (SCAC: ${invoice.carrier.scac})` : ''}
            </Text>
          </View>
          <View style={styles.invoiceInfo}>
            <Text style={styles.invoiceInfoLabel}>Invoice Total:</Text>
            <Text style={styles.invoiceInfoValue}>
              {formatCurrency(invoice.total_amount, invoice.currency)}
            </Text>
          </View>
        </View>

        {/* Discrepancies Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Discrepancies Found ({findings.length} issue{findings.length !== 1 ? 's' : ''})
          </Text>
          <View style={styles.priceBreakdown}>
            <View style={styles.priceRow}>
              <Text style={styles.priceLabel}>Total Potential Savings:</Text>
              <Text style={[styles.priceValue, styles.priceDelta]}>
                {formatCurrency(totalSavings, invoice.currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Individual Findings */}
        {findings.map((finding, index) => {
          const proofText = getProofText(finding);
          const hasExpectedAmount = finding.expected_amount !== null;
          const hasChargedAmount = finding.charged_amount !== null;

          return (
            <View key={finding.id} style={styles.finding} wrap={false}>
              <View style={styles.findingHeader}>
                <Text style={styles.findingTitle}>
                  Issue #{index + 1}: {formatLeakType(finding.leak_type)}
                </Text>
                <Text style={styles.findingSubtitle}>
                  Rule: {finding.rule_id} | Estimated Savings:{' '}
                  {formatCurrency(
                    finding.estimated_savings || finding.delta_amount,
                    invoice.currency
                  )}
                </Text>
              </View>

              <View style={styles.findingContent}>
                {/* Summary */}
                <Text style={styles.findingParagraph}>
                  <Text style={{ fontWeight: 'bold' }}>Summary: </Text>
                  {finding.summary}
                </Text>

                {/* Reasoning */}
                <Text style={styles.findingParagraph}>
                  <Text style={{ fontWeight: 'bold' }}>Details: </Text>
                  {finding.reasoning}
                </Text>

                {/* Price Breakdown */}
                {(hasExpectedAmount || hasChargedAmount) && (
                  <View style={styles.priceBreakdown}>
                    {hasExpectedAmount && (
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Expected Amount:</Text>
                        <Text style={styles.priceValue}>
                          {formatCurrency(
                            finding.expected_amount,
                            invoice.currency
                          )}
                        </Text>
                      </View>
                    )}
                    {hasChargedAmount && (
                      <View style={styles.priceRow}>
                        <Text style={styles.priceLabel}>Charged Amount:</Text>
                        <Text style={styles.priceValue}>
                          {formatCurrency(
                            finding.charged_amount,
                            invoice.currency
                          )}
                        </Text>
                      </View>
                    )}
                    <View style={styles.priceRow}>
                      <Text style={styles.priceLabel}>Discrepancy:</Text>
                      <Text style={[styles.priceValue, styles.priceDelta]}>
                        {formatCurrency(finding.delta_amount, invoice.currency)}
                        {finding.delta_amount > 0 ? ' (Overcharge)' : ' (Undercharge)'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Proof Section */}
                {proofText && (
                  <View style={styles.proofSection}>
                    <Text style={styles.proofTitle}>Supporting Evidence:</Text>
                    <Text style={styles.proofText}>{proofText}</Text>
                  </View>
                )}
              </View>
            </View>
          );
        })}

        {/* Footer */}
        <View style={styles.footer}>
          <Text>
            This dispute letter was automatically generated by Freight Invoice
            Auditor. Please review all findings and evidence before submitting.
          </Text>
        </View>

        {/* Page Number */}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
