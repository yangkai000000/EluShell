import React from 'react';
import { createRoot } from 'react-dom/client';
const App = React.lazy(() => import('./App'));
const EditorWindow = React.lazy(() => import('./EditorWindow'));
const editor = new URLSearchParams(location.search).has('editor');
import './style.css';
import './workspace.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>{editor ? <EditorWindow /> : <App />}</React.Suspense>
  </React.StrictMode>,
);

import './files.css';

import './management.css';
import './appearance.css';
import './commands.css';
import './updates.css';
import './connections-compact.css';
