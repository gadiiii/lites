import React from 'react';
import { createRoot } from 'react-dom/client';
import SimplePage from './SimplePage.js';

const root = document.getElementById('root');
if (root) createRoot(root).render(<SimplePage />);
