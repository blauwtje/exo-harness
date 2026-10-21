import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <MotionConfig reducedMotion="user"><App /></MotionConfig>,
);
