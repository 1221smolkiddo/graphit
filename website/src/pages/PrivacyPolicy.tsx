import React, { useEffect } from 'react';
import { Shield, Mail, ExternalLink } from 'lucide-react';
import { siteConfig } from '../config/siteConfig';

export const PrivacyPolicy: React.FC = () => {
  useEffect(() => {
    document.title = `Privacy Policy — ${siteConfig.name}`;
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="container-narrow" style={{ paddingTop: '3rem', paddingBottom: '6rem' }}>
      {/* Header */}
      <header style={{ marginBottom: '3rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '2rem' }}>
        <div className="badge" style={{ marginBottom: '1rem' }}>
          <Shield size={14} />
          <span>Local-First Transparency</span>
        </div>
        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: 'var(--text-primary)',
            marginBottom: '0.75rem',
          }}
        >
          {siteConfig.name} Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>
          Last updated: {siteConfig.privacyLastUpdated}
        </p>
      </header>

      {/* Policy Content */}
      <div className="docs-content" style={{ lineHeight: 1.8, fontSize: '1rem', color: 'var(--text-secondary)' }}>
        {/* Section 1 */}
        <h2>1. Overview</h2>
        <p>
          Graphit is designed from the ground up as a <strong>local-first developer tool</strong>. Most Graphit functionality operates entirely on the user's local machine. Graphit does not require a Graphit-hosted cloud account or subscription for its core functionality.
        </p>

        {/* Section 2 */}
        <h2>2. Information Graphit Processes</h2>
        <p>
          To provide code intelligence and persistent project memory, Graphit may process the following information locally on your computer:
        </p>
        <ul>
          <li>Repository source code files and directory structures.</li>
          <li>Project paths and local filesystem metadata.</li>
          <li>Code symbols, definitions, types, imports, calls, and syntactic relationships.</li>
          <li>Project memory items, including goals, tasks, decisions, and constraints.</li>
          <li>Commands and execution results explicitly recorded through Graphit interfaces.</li>
          <li>MCP interactions and payloads sent to Graphit by authorized host clients.</li>
          <li>Content-addressed source blobs and SQLite database records.</li>
        </ul>
        <p>
          Processing this data locally is strictly required to extract knowledge graphs, manage sessions, and compile token-budgeted context packets for your coding tasks.
        </p>

        {/* Section 3 */}
        <h2>3. Where Data Is Stored</h2>
        <p>
          By default, all Graphit project data is stored locally on the user's device inside the <code>.graphit/</code> directory of the initialized repository. Graphit does not require source code or repository history to be uploaded to any Graphit-operated server.
        </p>

        {/* Section 4 */}
        <h2>4. Telemetry</h2>
        <p>
          <strong>The current version of Graphit does not send product telemetry by default.</strong> It does not track command invocations, crash reports, or user activity over the network. If optional opt-in telemetry is introduced in future versions, it will be transparently documented and disclosed in advance.
        </p>

        {/* Section 5 */}
        <h2>5. AI Provider Conversations</h2>
        <p>
          <strong>Important privacy boundary:</strong> Graphit does <strong>NOT</strong> automatically read, record, or scrape complete private conversations from OpenAI Codex, Anthropic Claude, Google Gemini, Cursor, or any other AI applications.
        </p>
        <p>
          Graphit receives only the specific information explicitly supplied to it through supported CLI commands, <code>.graphit</code> bundle imports, or explicit MCP tool interactions. Future provider-specific integrations that might offer automatic transcript importing will feature distinct data-access behavior and will be disclosed separately.
        </p>

        {/* Section 6 */}
        <h2>6. Model Context Protocol (MCP)</h2>
        <p>
          When you configure an MCP host (such as Claude Desktop or Cursor) to communicate with Graphit, the host client may send project queries or context payloads to Graphit over <code>stdio</code>.
        </p>
        <p>
          Data received through Graphit's MCP server is processed locally on your device according to your project configuration. Graphit cannot control what an external AI provider itself collects or logs when you communicate with their services. Users should consult the privacy policy and terms of service of the third-party AI provider they choose to connect with Graphit.
        </p>

        {/* Section 7 */}
        <h2>7. Exported .graphit Files</h2>
        <p>
          When users run <code>graphit export</code>, Graphit creates a portable project archive. That archive may contain proprietary source code, historical commands, chat events, and decision logs.
        </p>
        <p>
          Users are solely responsible for controlling where exported <code>.graphit</code> bundles are stored, backed up, transmitted, or shared. To protect bundles in transit, Graphit provides native support for authenticated encrypted exports.
        </p>

        {/* Section 8 */}
        <h2>8. Encryption & Local Disk Security</h2>
        <p>
          Encrypted <code>.graphit</code> exports use authenticated encryption (AES-256-GCM with <code>scrypt</code> key derivation and authenticated metadata headers).
        </p>
        <div
          style={{
            padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(251, 191, 36, 0.05)',
            border: '1px solid rgba(251, 191, 36, 0.25)',
            color: 'var(--accent-amber)',
            fontSize: '0.9rem',
            margin: '1.25rem 0',
          }}
        >
          <strong>Technical Limitation Disclosure: </strong>
          Graphit's live SQLite project database (<code>.graphit/graphit.db</code>) is <strong>not currently encrypted by Graphit at rest</strong>. Users who require local disk encryption must utilize operating-system or filesystem-level encryption tools, such as BitLocker (Windows), FileVault (macOS), or LUKS (Linux).
        </div>

        {/* Section 9 */}
        <h2>9. Third Parties</h2>
        <p>
          Graphit may be utilized alongside third-party developer platforms and tools, including:
        </p>
        <ul>
          <li><strong>npm:</strong> Package distribution and updates.</li>
          <li><strong>GitHub:</strong> Source code repository hosting and issue tracking.</li>
          <li><strong>AI and MCP Clients:</strong> Anthropic Claude, Cursor, OpenAI, and other agent hosts.</li>
          <li><strong>Deployment Hosts:</strong> Static hosting platforms (e.g. GitHub Pages, Vercel, Cloudflare).</li>
        </ul>
        <p>
          Graphit has no control over these external services, and their respective privacy policies apply to any data you transmit to them.
        </p>

        {/* Section 10 */}
        <h2>10. Website Data & Analytics</h2>
        <p>
          <strong>The Graphit website does not intentionally use first-party analytics, behavioral tracking, or advertising trackers.</strong> We do not deploy Google Analytics, Meta Pixel, Hotjar, or fingerprinting scripts, and we set no non-essential cookies.
        </p>
        <p>
          When you access the website, the infrastructure hosting provider may automatically process standard technical request information (such as client IP address, browser user-agent header, and server access logs) in accordance with the hosting provider's own technical and security policies.
        </p>

        {/* Section 11 */}
        <h2>11. Data Sharing & Selling</h2>
        <p>
          The current Graphit software does not sell personal information or repository contents. Graphit does not send your local codebase, symbols, or memory items to advertisers or third-party data brokers.
        </p>

        {/* Section 12 */}
        <h2>12. Data Retention</h2>
        <p>
          Local Graphit project data remains stored on the user's machine indefinitely until the user chooses to delete it. Exported <code>.graphit</code> archives remain wherever the user places them until manually deleted. Third-party AI providers connected via MCP maintain their own independent data retention policies.
        </p>

        {/* Section 13 */}
        <h2>13. Data Deletion</h2>
        <p>
          You retain complete control over your data. To delete all local Graphit project data, simply delete the <code>.graphit/</code> directory in your repository root.
        </p>
        <p>
          Please note that deleting local Graphit data cannot retroactively delete information or prompts previously submitted to third-party AI model providers or external MCP services.
        </p>

        {/* Section 14 */}
        <h2>14. Security Measures</h2>
        <p>
          Graphit incorporates several defensive architectural patterns to protect project integrity:
        </p>
        <ul>
          <li><strong>Immutable SHA-256 source blobs:</strong> Detects and prevents silent file corruption.</li>
          <li><strong>SQLite integrity triggers:</strong> Rejects unlawful modifications to canonical event records.</li>
          <li><strong>Authenticated encrypted archives:</strong> Protects exports with AES-256-GCM.</li>
          <li><strong>Transactional repair:</strong> Rebuilds derived indexes safely without altering canonical facts.</li>
          <li><strong>Local-first isolation:</strong> Keeps data strictly on your device.</li>
        </ul>
        <p>
          No software system can be claimed as "100% secure." Local file security relies on host OS permissions, safe secret management, and user operational practices.
        </p>

        {/* Section 15 */}
        <h2>15. Children's Privacy</h2>
        <p>
          Graphit is a technical developer tool intended for software engineers and is not specifically directed toward children.
        </p>

        {/* Section 16 */}
        <h2>16. Changes to this Privacy Policy</h2>
        <p>
          We may update this Privacy Policy periodically as Graphit evolves (for instance, if cloud synchronization or additional provider integrations are developed). Any material changes will be documented in the project repository and reflected on this page with an updated date.
        </p>

        {/* Section 17 */}
        <h2>17. Contact & Issue Reporting</h2>
        <p>
          If you have questions regarding this Privacy Policy or wish to report a privacy concern, please contact us through:
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', margin: '1.25rem 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <ExternalLink size={16} color="var(--accent-cyan)" />
            <span>GitHub Issues: </span>
            <a href={siteConfig.githubIssuesUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-cyan)', textDecoration: 'underline' }}>
              {siteConfig.githubIssuesUrl}
            </a>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <Mail size={16} color="var(--accent-cyan)" />
            <span>Privacy Contact: </span>
            <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
              {siteConfig.privacyContactEmail}
            </code>
          </div>
        </div>

        {/* Mandatory Footer Disclaimer */}
        <div
          style={{
            marginTop: '3.5rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}
        >
          This policy describes Graphit's current technical behavior and is not a substitute for jurisdiction-specific legal advice.
        </div>
      </div>
    </div>
  );
};
