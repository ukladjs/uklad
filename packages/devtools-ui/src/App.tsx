import Header from './components/Header';
import TracesListPanel from './components/TracesListPanel';
import StatePanel from './components/StatePanel';
import TraceDetailsPanel from './components/trace/TraceDetailsPanel';
import Splitter from './components/ui/Splitter';
import { ThemeProvider } from './contexts/ThemeContext';
import { DispatchEventModal } from './components/DispatchEventModal';

function App() {
  return (
    <ThemeProvider>
      <div className="app-container">
        <Header />

        <main className="main-content">
          <div className="split-layout" style={{'--split-position': '25%'} as React.CSSProperties}>
            <TracesListPanel />
            <Splitter />
            <div className="vertical-split-layout" style={{'--vertical-split-position': '70%'} as React.CSSProperties}>
              <StatePanel />
              <Splitter orientation="vertical" />
              <TraceDetailsPanel />
            </div>
          </div>
        </main>

        <DispatchEventModal />
      </div>
    </ThemeProvider>
  );
}

export default App; 