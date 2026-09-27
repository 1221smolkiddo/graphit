import { useEffect } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';

// Pages
import { Home } from './pages/Home';
import { DocsOverview } from './pages/docs/DocsOverview';
import { GettingStarted } from './pages/docs/GettingStarted';
import { CliReference } from './pages/docs/CliReference';
import { McpSetup } from './pages/docs/McpSetup';
import { Architecture } from './pages/docs/Architecture';
import { ProjectMemory } from './pages/docs/ProjectMemory';
import { Retrieval } from './pages/docs/Retrieval';
import { Portability } from './pages/docs/Portability';
import { DataPreservation } from './pages/docs/DataPreservation';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { Benchmarks } from './pages/Benchmarks';

// Scroll to top helper on route change
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <ScrollToTop />
      <Navbar />

      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/docs" element={<DocsOverview />} />
          <Route path="/docs/getting-started" element={<GettingStarted />} />
          <Route path="/docs/cli" element={<CliReference />} />
          <Route path="/docs/mcp" element={<McpSetup />} />
          <Route path="/docs/architecture" element={<Architecture />} />
          <Route path="/docs/memory" element={<ProjectMemory />} />
          <Route path="/docs/retrieval" element={<Retrieval />} />
          <Route path="/docs/portability" element={<Portability />} />
          <Route path="/docs/data-preservation" element={<DataPreservation />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/benchmarks" element={<Benchmarks />} />
          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}

export default App;
