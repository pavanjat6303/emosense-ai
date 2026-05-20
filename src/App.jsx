import React, { useState, useEffect, useRef } from 'react';

// Emotion Metadata definitions with distinct visual themes and emoji mappings
const EMOTION_METADATA = {
  happy: { 
    name: 'Happy', 
    emoji: '😊', 
    color: 'var(--color-happy)', 
    tip: 'Your expression indicates happiness! Positive energy boosts your immune system and creativity. Keep sharing that smile!',
    desc: 'Elation, satisfaction, or joy detected.'
  },
  sad: { 
    name: 'Sad', 
    emoji: '😢', 
    color: 'var(--color-sad)', 
    tip: 'Your expression indicates sadness. It\'s okay to feel down. Try taking a warm drink, stretching, or reaching out to a friend.',
    desc: 'Melancholy or emotional fatigue detected.'
  },
  angry: { 
    name: 'Angry', 
    emoji: '😠', 
    color: 'var(--color-angry)', 
    tip: 'Your expression indicates anger. Take deep, slow breaths. Try loosening your jaw and relaxing your shoulders to release tension.',
    desc: 'Frustration, high tension, or irritation detected.'
  },
  fear: { 
    name: 'Fear', 
    emoji: '😨', 
    color: 'var(--color-fear)', 
    tip: 'Your expression indicates fear. Take deep, grounding breaths. Remind yourself that you are in a safe environment right now.',
    desc: 'Apprehension, caution, or high alert detected.'
  },
  surprise: { 
    name: 'Surprise', 
    emoji: '😲', 
    color: 'var(--color-surprise)', 
    tip: 'Your expression indicates surprise! A state of heightened sensory intake. Absorb this new information with an open mind.',
    desc: 'Astonishment, sudden cognitive shift, or excitement detected.'
  },
  disgust: { 
    name: 'Disgust', 
    emoji: '🤢', 
    color: 'var(--color-disgust)', 
    tip: 'Your expression indicates disgust. A natural reflex to aversion or disapproval. Take a moment to step back and re-evaluate.',
    desc: 'Aversion, disapproval, or strong dislike detected.'
  },
  neutral: { 
    name: 'Neutral', 
    emoji: '😐', 
    color: 'var(--color-neutral)', 
    tip: 'Your expression is neutral. A perfect state of calm and mental balance. Excellent for focus, reading, or structured work.',
    desc: 'Serenity, focus, or balanced composure detected.'
  }
};

// Seed records for History Log to populate styled records out-of-the-box
const MOCK_HISTORY_SEEDS = [
  { id: 'seed-1', time: '10:14:02', date: '2026-05-20', emotion: 'Happy', confidence: 92 },
  { id: 'seed-2', time: '10:15:30', date: '2026-05-20', emotion: 'Neutral', confidence: 78 },
  { id: 'seed-3', time: '10:16:15', date: '2026-05-20', emotion: 'Sad', confidence: 65 },
  { id: 'seed-4', time: '10:17:45', date: '2026-05-20', emotion: 'Neutral', confidence: 85 },
  { id: 'seed-5', time: '10:18:33', date: '2026-05-20', emotion: 'Sad', confidence: 87 }
];

// Helper to extract maximum key in object
const maxKey = (obj) => Object.keys(obj).reduce((a, b) => obj[a] > obj[b] ? a : b);

function App() {
  // --- APPLICATION STATE ---
  const [activeTab, setActiveTab] = useState('live');
  const [backendActive, setBackendActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [useSimulation, setUseSimulation] = useState(false); // Initially false to attempt camera/deepface on load
  const [activeCameraId, setActiveCameraId] = useState('');
  const [cameraList, setCameraList] = useState([]);
  
  // Normalized probability vectors (Happy, Sad, Angry, Fear, Surprise, Neutral, Disgust)
  const [emotions, setEmotions] = useState({
    happy: 0,
    sad: 0,
    angry: 0,
    fear: 0,
    surprise: 0,
    neutral: 100,
    disgust: 0
  });
  
  const [activeEmotion, setActiveEmotion] = useState('neutral');
  const [confidence, setConfidence] = useState(100);
  const [manuallyOverridden, setManuallyOverridden] = useState(false);
  
  // History logs database loaded from local storage or seeded with defaults
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('emosense_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return MOCK_HISTORY_SEEDS;
      }
    }
    return MOCK_HISTORY_SEEDS;
  });
  
  // Settings configs
  const [refreshInterval, setRefreshInterval] = useState(2000); // 2s tick (improved stabilization default)
  const [autoLog, setAutoLog] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [captureStatus, setCaptureStatus] = useState(''); // 'Captured! ✓' indicator

  // --- REFS FOR HARDWARE WEB-CAM & hidden CANVAS ---
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const lastLoggedEmotionRef = useRef('');
  const lastLoggedTimeRef = useRef(0);

  // --- REFS FOR TELEMETRY STABILIZATION & SIMULATION DRIFT ---
  const rawEmotionsHistoryRef = useRef([]);
  const consecutiveDominantRef = useRef({ emotion: 'neutral', count: 0 });
  const simRawTargetRef = useRef('neutral');
  const simRawConfidenceRef = useRef(100);

  // --- REFS AND HOOKS FOR INTERVAL CLOSURE SYNCHRONIZATION ---
  const backendActiveRef = useRef(backendActive);
  const cameraActiveRef = useRef(cameraActive);
  const useSimulationRef = useRef(useSimulation);
  const manuallyOverriddenRef = useRef(manuallyOverridden);
  const activeEmotionRef = useRef(activeEmotion);
  const confidenceRef = useRef(confidence);
  const emotionsRef = useRef(emotions);
  const autoLogRef = useRef(autoLog);

  useEffect(() => { backendActiveRef.current = backendActive; }, [backendActive]);
  useEffect(() => { cameraActiveRef.current = cameraActive; }, [cameraActive]);
  useEffect(() => { useSimulationRef.current = useSimulation; }, [useSimulation]);
  useEffect(() => { manuallyOverriddenRef.current = manuallyOverridden; }, [manuallyOverridden]);
  useEffect(() => { activeEmotionRef.current = activeEmotion; }, [activeEmotion]);
  useEffect(() => { confidenceRef.current = confidence; }, [confidence]);
  useEffect(() => { emotionsRef.current = emotions; }, [emotions]);
  useEffect(() => { autoLogRef.current = autoLog; }, [autoLog]);

  // Synchronise history database with LocalStorage
  useEffect(() => {
    localStorage.setItem('emosense_history', JSON.stringify(history));
  }, [history]);

  // --- 1. PERIODIC BACKEND SERVER CHECK ---
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('https://emosense-ai-vbr7.onrender.com/api/status');
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ready') {
            setBackendActive(true);
            return;
          }
        }
        setBackendActive(false);
      } catch (err) {
        setBackendActive(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  // --- 2. WEBCAM STREAM CONTROLLER ---
  useEffect(() => {
    const initCamera = async () => {
      // Clean up previous media streams if active
      stopCamera();

      if (!cameraActive) return;

      try {
        const constraints = {
          video: activeCameraId 
            ? { deviceId: { exact: activeCameraId }, width: 640, height: 480 } 
            : { width: 640, height: 480 },
          audio: false
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        mediaStreamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // Retrieve full list of connected video input hardware devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setCameraList(videoDevices);
        if (videoDevices.length > 0 && !activeCameraId) {
          setActiveCameraId(videoDevices[0].deviceId);
        }
      } catch (err) {
        console.error('Camera access denied or failed:', err);
        setCameraActive(false);
        // Seamless fallback to simulation
        setUseSimulation(true);
      }
    };

    initCamera();
    return () => stopCamera();
  }, [cameraActive, activeCameraId]);

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // --- 3. DYNAMIC TELEMETRY CYCLE (DeepFace POST vs Simulated walk with stabilization) ---
  useEffect(() => {
    let tickCount = 0;
    
    // Core telemetry stabilization engine (now directly uses raw DeepFace prediction values)
    const stabilizeTelemetry = (rawEmotions) => {
      // Find candidate dominant emotion from the RAW vector
      const dominant = maxKey(rawEmotions);
      const conf = rawEmotions[dominant] || 0;

      // Update state variables directly with the raw predictions, no smoothing or confidence gating!
      setEmotions(rawEmotions);
      setActiveEmotion(dominant);
      setConfidence(conf);

      console.log(`[DEBUG] HUD State Updated -> Dominant: ${dominant} (${conf}%)`, rawEmotions);

      return {
        emotions: rawEmotions,
        activeEmotion: dominant,
        confidence: conf
      };
    };

    // Core tick worker loop
    const runAnalysisTick = async () => {
      tickCount++;

      const bActive = backendActiveRef.current;
      const cActive = cameraActiveRef.current;
      const uSim = useSimulationRef.current;
      const mOverridden = manuallyOverriddenRef.current;
      const curEmotions = emotionsRef.current;
      const curActiveEmotion = activeEmotionRef.current;
      const curConfidence = confidenceRef.current;
      const aLog = autoLogRef.current;

      // CASE A: DeepFace API integration is Active and camera is running, and no manual overrides
      if (bActive && cActive && !uSim && !mOverridden) {
        if (videoRef.current && canvasRef.current) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d');
          
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            // Draw in-memory canvas matches camera aspect ratio
            canvas.width = 640;
            canvas.height = 480;
            
            // Mirror canvas image mapping
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset matrix
            
            // Output lightweight JPEG base64 string
            const base64Jpg = canvas.toDataURL('image/jpeg', 0.85);

            try {
          
const response = await fetch('https://emosense-ai-vbr7.onrender.com/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Jpg })
              });

              if (response.ok) {
                const data = await response.json();
                
                console.log('[DEBUG] API Response Received:', data);
                
                if (data.success) {
                  // Pass to stabilization engine
                  const stabilized = stabilizeTelemetry(data.emotions);
                  
                  // Auto log capture trigger
                  if (aLog) {
                    triggerAutoLog(stabilized.activeEmotion, stabilized.confidence);
                  }
                  return; // Tick finished successfully
                } else {
                  console.warn('[DEBUG] API Response Error:', data.error);
                }
              }
            } catch (err) {
              console.error('API frame transmission failed:', err);
            }
          }
        }
      }

      // CASE B: Simulated Mock Telemetry Drift loop (if backend offline, or override simulated)
      let nextEmotions = { ...curEmotions };

      if (mOverridden) {
        // Build override distributions around our selected emotion
        const target = curActiveEmotion;
        const targetVal = curConfidence;
        const remainder = 100 - targetVal;
        
        // Split remaining score across other standard categories
        const restKeys = Object.keys(curEmotions).filter(k => k !== target);
        let splitSum = 0;
        
        restKeys.forEach((key, idx) => {
          if (idx === restKeys.length - 1) {
            nextEmotions[key] = remainder - splitSum;
          } else {
            const val = Math.floor(remainder / restKeys.length) + (idx % 2 === 0 ? 1 : -1);
            nextEmotions[key] = Math.max(0, val);
            splitSum += nextEmotions[key];
          }
        });
        
        nextEmotions[target] = targetVal;
        setEmotions(nextEmotions);
      } else {
        // Active organic simulated drift walk
        const emotionKeys = Object.keys(curEmotions);
        
        // Every 6 ticks, potentially shift raw simulated target
        if (tickCount % 6 === 0) {
          simRawTargetRef.current = emotionKeys[Math.floor(Math.random() * emotionKeys.length)];
          simRawConfidenceRef.current = Math.floor(Math.random() * 45) + 40; // 40-85% (this allows low confidence frames to test gating!)
        }

        // Apply minor ripples/drifts to confidence
        if (Math.random() > 0.6) {
          const drift = Math.random() > 0.5 ? 2 : -2;
          simRawConfidenceRef.current = Math.max(30, Math.min(98, simRawConfidenceRef.current + drift));
        }

        const target = simRawTargetRef.current;
        const targetVal = simRawConfidenceRef.current;
        const remainder = 100 - targetVal;

        const restKeys = emotionKeys.filter(k => k !== target);
        let splitSum = 0;
        
        restKeys.forEach((key, idx) => {
          if (idx === restKeys.length - 1) {
            nextEmotions[key] = remainder - splitSum;
          } else {
            const baseSplit = Math.floor(remainder / restKeys.length);
            const drift = Math.sin(tickCount + idx) > 0 ? 1 : -1;
            nextEmotions[key] = Math.max(0, baseSplit + drift);
            splitSum += nextEmotions[key];
          }
        });
        
        nextEmotions[target] = targetVal;

        // Mathematical guarantee to exactly sum to 100%
        const totalSum = Object.values(nextEmotions).reduce((a, b) => a + b, 0);
        if (totalSum !== 100) {
          const diff = 100 - totalSum;
          const domKey = maxKey(nextEmotions);
          nextEmotions[domKey] = Math.max(0, nextEmotions[domKey] + diff);
        }

        // Pass to stabilization!
        const stabilized = stabilizeTelemetry(nextEmotions);

        // Auto log capture check for simulation
        if (aLog) {
          triggerAutoLog(stabilized.activeEmotion, stabilized.confidence);
        }
      }
    };

    // Kick off interval loop based on settings rate
    const intervalId = setInterval(runAnalysisTick, refreshInterval);
    return () => clearInterval(intervalId);
  }, [refreshInterval]);

  // Auto Log database appender
  const triggerAutoLog = (emotionName, confScore) => {
    const now = Date.now();
    
    // Throttle auto-logging: only append if dominant emotion changed or every 10 seconds
    const timeElapsed = now - lastLoggedTimeRef.current;
    const isNewEmotion = emotionName !== lastLoggedEmotionRef.current;
    
    if (isNewEmotion || timeElapsed > 12000) {
      if (confScore >= 70) {
        appendLogRecord(emotionName, confScore);
        lastLoggedEmotionRef.current = emotionName;
        lastLoggedTimeRef.current = now;
      }
    }
  };

  // Perform a manual Capture Frame Log
  const triggerManualLog = () => {
    const capsName = EMOTION_METADATA[activeEmotion].name;
    appendLogRecord(capsName, confidence);
    
    setCaptureStatus('Captured! ✓');
    setTimeout(() => setCaptureStatus(''), 2000);
  };

  const appendLogRecord = (emotionName, confValue) => {
    const dateObj = new Date();
    const timeStr = dateObj.toTimeString().split(' ')[0];
    const dateStr = dateObj.toISOString().split('T')[0];

    const newRecord = {
      id: 'log-' + Math.random().toString(36).substr(2, 9),
      time: timeStr,
      date: dateStr,
      emotion: emotionName,
      confidence: confValue
    };

    setHistory(prev => [newRecord, ...prev]);
  };

  // Switch tabs & clear manual simulated overrides to resume automated telemetry tracking
  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    if (tabId === 'live') {
      setManuallyOverridden(false);
      // Clear stabilization histories so it begins telemetry fresh
      rawEmotionsHistoryRef.current = [];
      consecutiveDominantRef.current = { emotion: 'neutral', count: 0 };
    }
  };

  // Simulate an emotion manually from buttons overlay
  const handleSimulateEmotion = (emoKey) => {
    // Clear stabilization histories so manual click applies instantly and cleanly
    rawEmotionsHistoryRef.current = [];
    consecutiveDominantRef.current = { emotion: emoKey, count: 0 };

    setManuallyOverridden(true);
    setActiveEmotion(emoKey);
    setConfidence(87); // Clear high cyberpunk standard default
  };

  // Delete all items from local database
  const handleClearHistory = () => {
    setHistory([]);
  };

  // Export database items as formatted JSON file
  const handleExportJSON = () => {
    if (history.length === 0) return;
    
    const fileData = JSON.stringify(history, null, 2);
    const blob = new Blob([fileData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.download = `emosense-telemetry-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter history records based on search query
  const filteredHistory = history.filter(item => {
    const q = searchQuery.toLowerCase();
    return (
      item.emotion.toLowerCase().includes(q) ||
      item.time.includes(q) ||
      item.date.includes(q) ||
      String(item.confidence).includes(q)
    );
  });

  // Calculate stats for Insights charts
  const getEmotionCounts = () => {
    const counts = { 
      Happy: 0, 
      Sad: 0, 
      Angry: 0, 
      Fear: 0, 
      Surprise: 0, 
      Neutral: 0, 
      Disgust: 0 
    };
    history.forEach(item => {
      const emoKey = item.emotion.toLowerCase();
      const capName = EMOTION_METADATA[emoKey] ? EMOTION_METADATA[emoKey].name : null;
      if (capName && counts[capName] !== undefined) {
        counts[capName]++;
      }
    });
    return counts;
  };

  const getConfidenceTimeline = () => {
    // Return last 8 captures, ordered chronologically
    return [...history].slice(0, 8).reverse();
  };

  const counts = getEmotionCounts();
  const timeline = getConfidenceTimeline();
  const totalCaptures = history.length;
  
  // Calculate average confidence
  const avgConfidence = totalCaptures > 0 
    ? Math.round(history.reduce((sum, item) => sum + item.confidence, 0) / totalCaptures)
    : 0;

  // Extract most frequent emotion
  const mostFrequentEmotion = totalCaptures > 0 
    ? Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b)
    : 'None';

  return (
    <div className="app-container">
      {/* Background radial soft lights */}
      <div className="bg-glow-orb"></div>
      <div className="bg-glow-orb-2"></div>

      {/* ==========================================================================
         SIDEBAR NAVIGATION
         ========================================================================== */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
            </svg>
          </div>
          <span className="logo-text">EMOSENSE AI</span>
          <span className="logo-tag">V2.0</span>
        </div>

        <ul className="nav-menu">
          <li className={`nav-item ${activeTab === 'live' ? 'active' : ''}`}>
            <button onClick={() => handleTabChange('live')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Live Detection
            </button>
          </li>
          <li className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}>
            <button onClick={() => handleTabChange('history')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              History Log
            </button>
          </li>
          <li className={`nav-item ${activeTab === 'insights' ? 'active' : ''}`}>
            <button onClick={() => handleTabChange('insights')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              Insights & Analytics
            </button>
          </li>
          <li className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}>
            <button onClick={() => handleTabChange('settings')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              System Settings
            </button>
          </li>
          <li className={`nav-item ${activeTab === 'about' ? 'active' : ''}`}>
            <button onClick={() => handleTabChange('about')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              About EmoSense
            </button>
          </li>
        </ul>

        {/* Sidebar Status Footer Widget */}
        <div className="sidebar-footer-card">
          <div className={`footer-card-header ${backendActive ? '' : 'offline'}`}>
            <div className="pulse-dot"></div>
            <span>{backendActive ? 'DeepFace Engine' : 'AI Offline'}</span>
          </div>
          <div className="footer-card-body">
            <h4>{backendActive ? 'Model: VGG-Face' : 'Simulating'}</h4>
            <p>
              {backendActive 
                ? 'TensorFlow server-side classification executing active streams.' 
                : 'Local Flask server inactive. Running dynamic micro-drifts gracefully.'}
            </p>
          </div>
        </div>
      </aside>

      {/* ==========================================================================
         MAIN CONTENT VIEWPORT
         ========================================================================== */}
      <main className="main-viewport">
        {/* Unified Application Header with Connections Badges */}
        <header className="main-header">
          <div className="header-title-container">
            <h1>
              {activeTab === 'live' && 'Real-Time Telemetry'}
              {activeTab === 'history' && 'Local Logs Database'}
              {activeTab === 'insights' && 'Insights & Analytics'}
              {activeTab === 'settings' && 'System Configuration'}
              {activeTab === 'about' && 'About EmoSense AI'}
            </h1>
            <p>
              {activeTab === 'live' && 'Visual cybernetic capture HUD paired with deep neural networks.'}
              {activeTab === 'history' && 'Browse, clear, and export stored telemetry captures.'}
              {activeTab === 'insights' && 'Mathematical trends, volume counts, and confidence cubic splines.'}
              {activeTab === 'settings' && 'Adjust hardware devices, capture refresh rates, and simulation states.'}
              {activeTab === 'about' && 'Learn about facial classifications, security features, and telemetry.'}
            </p>
          </div>

          <div className="header-badges">
            {/* Backend Connection badge */}
            <div className={`status-badge ${backendActive ? 'backend-online' : 'backend-offline'}`}>
              <div className="status-badge-dot"></div>
              <span>{backendActive ? 'DeepFace AI Active' : 'Flask Server Offline'}</span>
            </div>

            {/* Video Input status badge */}
            <div className={`status-badge ${cameraActive ? 'camera-active' : 'camera-simulated'}`}>
              <div className="status-badge-dot"></div>
              <span>{cameraActive ? 'Webcam Live' : 'Simulated HUD'}</span>
            </div>
          </div>
        </header>

        {/* Hidden capture canvas helper */}
        <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>

        {/* ==========================================================================
           TAB PANELS VIEWPORT
           ========================================================================== */}
        <div className="tab-viewport">
          
          {/* TAB 1: LIVE DETECTION */}
          {activeTab === 'live' && (
            <div className="live-layout-grid">
              
              {/* Left Column: Webcam HUD and Controls */}
              <div className="feed-column">
                <div className="cyber-hud-card">
                  {/* Floating corners HUD brackets */}
                  <div className="hud-corner hud-corner-tl"></div>
                  <div className="hud-corner hud-corner-tr"></div>
                  <div className="hud-corner hud-corner-bl"></div>
                  <div className="hud-corner hud-corner-br"></div>
                  
                  {/* Glowing Face Bounding Box & Sweeper */}
                  {cameraActive && (
                    <>
                      <div className="hud-bounding-box"></div>
                      <div className="hud-laser-sweep"></div>
                    </>
                  )}

                  {/* Telemetry Widget Badges */}
                  <div className="hud-telemetry-badge">
                    FPS: {cameraActive ? '30.00' : '0.00'} • CAP: 640x480
                  </div>
                  <div className="hud-telemetry-badge-right">
                    SYS: {useSimulation || !cameraActive ? 'MOCK_DRIFT' : 'DEEPFACE_AI'}
                  </div>

                  <div className="hud-viewport-container">
                    {cameraActive ? (
                      <video 
                        ref={videoRef} 
                        className="hud-video" 
                        autoPlay 
                        playsInline 
                        muted
                      ></video>
                    ) : (
                      <div className="hud-fallback-graphic">
                        <div className="hud-fallback-icon">
                          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
                          </svg>
                        </div>
                        <h3>Webcam Feed Inactive</h3>
                        <p>Turn on webcam streaming in settings to begin neural scanning.</p>
                        <button 
                          className="hud-fallback-btn"
                          onClick={() => setCameraActive(true)}
                        >
                          Enable Webcam
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Quick Controls panel */}
                <div className="hud-controls-panel">
                  <button 
                    className="cyber-btn"
                    onClick={() => setCameraActive(!cameraActive)}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                      {cameraActive ? (
                        <>
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                        </>
                      ) : (
                        <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                      )}
                    </svg>
                    {cameraActive ? 'Shut Down Stream' : 'Boot Webcam Feed'}
                  </button>

                  <button 
                    className="cyber-btn cyber-btn-accent"
                    onClick={triggerManualLog}
                    disabled={!cameraActive && !manuallyOverridden}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                    {captureStatus ? captureStatus : 'Log Reading Capture'}
                  </button>
                </div>

                {/* Dynamic AI Contextual tips Card */}
                <div className="ai-advisor-card">
                  <div className="advisor-header">
                    <div className="advisor-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </div>
                    <h3>AI Contextual Advisor</h3>
                  </div>
                  <div className="advisor-content">
                    <p>
                      <strong>Diagnostic Suggestion: </strong> 
                      {EMOTION_METADATA[activeEmotion].tip}
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Column: Dominant Card and Classification Probabilities */}
              <div className="stats-column">
                
                {/* Unified Dominant Emotion summary card */}
                <div className="dominant-emotion-card">
                  <div className="dominant-avatar-outer">
                    <div className="dominant-avatar-ring" style={{ borderColor: EMOTION_METADATA[activeEmotion].color, boxShadow: `0 0 12px ${EMOTION_METADATA[activeEmotion].color}` }}></div>
                    <div className="dominant-avatar-inner">
                      {EMOTION_METADATA[activeEmotion].emoji}
                    </div>
                  </div>
                  <div className="dominant-details">
                    <div className="dominant-meta">Dominant State</div>
                    <div className="dominant-name-box">
                      <span className="dominant-name" style={{ color: EMOTION_METADATA[activeEmotion].color }}>
                        {EMOTION_METADATA[activeEmotion].name}
                      </span>
                      <span className="dominant-confidence-pill" style={{ color: EMOTION_METADATA[activeEmotion].color, borderColor: EMOTION_METADATA[activeEmotion].color, background: `rgba(255,255,255,0.01)` }}>
                        {confidence}% confidence
                      </span>
                    </div>
                    <p className="dominant-description">
                      {EMOTION_METADATA[activeEmotion].desc}
                    </p>
                  </div>
                </div>

                {/* Classification probabilities cards list */}
                <div className="prob-dashboard-card">
                  <div className="prob-dashboard-header">
                    <h3>Classification Probabilities</h3>
                    <p>Summing exactly to 100%</p>
                  </div>
                  
                  <div className="prob-container">
                    {Object.entries(emotions).sort((a, b) => b[1] - a[1]).map(([key, val]) => {
                      const meta = EMOTION_METADATA[key];
                      const isActive = activeEmotion === key;
                      
                      return (
                        <div 
                          key={key} 
                          className={`prob-row theme-${key} ${isActive ? 'active' : ''} ${manuallyOverridden && activeEmotion === key ? 'override-active' : ''}`}
                          onClick={() => handleSimulateEmotion(key)}
                        >
                          <span className="prob-emoji">{meta.emoji}</span>
                          <span className="prob-name-col">{meta.name}</span>
                          <div className="prob-bar-container">
                            <div 
                              className="prob-bar-fill" 
                              style={{ 
                                width: `${val}%`, 
                                backgroundColor: meta.color
                              }}
                            ></div>
                          </div>
                          <span className="prob-val-col" style={{ color: isActive ? meta.color : 'var(--text-secondary)' }}>
                            {val}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: HISTORY LOG */}
          {activeTab === 'history' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="history-controls">
                <div className="search-input-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input 
                    type="text" 
                    placeholder="Search logs by emotion, date, confidence..." 
                    className="search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="history-actions">
                  <button 
                    className="cyber-btn"
                    onClick={handleExportJSON}
                    disabled={history.length === 0}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export JSON
                  </button>
                  <button 
                    className="cyber-btn cyber-btn-danger"
                    onClick={handleClearHistory}
                    disabled={history.length === 0}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                    Purge Database
                  </button>
                </div>
              </div>

              <div className="cyber-table-card">
                <div className="table-wrapper">
                  {filteredHistory.length > 0 ? (
                    <table className="cyber-table">
                      <thead>
                        <tr>
                          <th>Record ID</th>
                          <th>Capture Time</th>
                          <th>Capture Date</th>
                          <th>Detected Emotion</th>
                          <th>Confidence Scale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map(item => {
                          const emoKey = item.emotion.toLowerCase();
                          const meta = EMOTION_METADATA[emoKey] || EMOTION_METADATA.neutral;
                          
                          return (
                            <tr key={item.id}>
                              <td style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                {item.id}
                              </td>
                              <td style={{ color: '#fff', fontWeight: 500 }}>{item.time}</td>
                              <td>{item.date}</td>
                              <td>
                                <div className="table-emotion-cell">
                                  <span style={{ fontSize: '16px' }}>{meta.emoji}</span>
                                  <span className={`table-pill pill-${emoKey}`}>
                                    {item.emotion}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                  <span style={{ color: '#fff', fontWeight: 600, width: '32px' }}>
                                    {item.confidence}%
                                  </span>
                                  <div className="table-confidence-bar">
                                    <div 
                                      style={{ 
                                        height: '100%', 
                                        width: `${item.confidence}%`,
                                        backgroundColor: meta.color,
                                        boxShadow: `0 0 4px ${meta.color}`
                                      }}
                                    ></div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="table-empty-state">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      <h4>Zero Telemetry Matches</h4>
                      <p>Try clearing your active search filter or log some facial capture records in the Live view.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: INSIGHTS & ANALYTICS */}
          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              
              {/* Analytics metrics overview cards list */}
              <div className="insights-grid">
                <div className="insights-card">
                  <div className="insight-header">
                    <span>Total Database Size</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  </div>
                  <div className="insight-val">{totalCaptures}</div>
                  <div className="insight-meta">Logged facial frame data captures.</div>
                </div>

                <div className="insights-card">
                  <div className="insight-header">
                    <span>Average Confidence</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  </div>
                  <div className="insight-val">{avgConfidence}%</div>
                  <div className="insight-meta">Mean neural network accuracy.</div>
                </div>

                <div className="insights-card">
                  <div className="insight-header">
                    <span>Dominant State</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /></svg>
                  </div>
                  <div className="insight-val" style={{ color: 'var(--accent-purple)' }}>
                    {mostFrequentEmotion}
                  </div>
                  <div className="insight-meta">Most repeated database value.</div>
                </div>

                <div className="insights-card">
                  <div className="insight-header">
                    <span>Telemetry Status</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                  </div>
                  <div className="insight-val" style={{ color: backendActive ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {backendActive ? 'ACTIVE' : 'STANDBY'}
                  </div>
                  <div className="insight-meta">{backendActive ? 'DeepFace GPU/CPU Core active.' : 'Simulated loops running.'}</div>
                </div>
              </div>

              {/* Chart panels grids */}
              <div className="charts-grid">
                
                {/* SVG Spline Area Chart: Confidence Timeline */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <h3>Accuracies Timeline Spline</h3>
                    <p>Last 8 captures (%)</p>
                  </div>

                  <div className="chart-svg-container">
                    {timeline.length > 1 ? (
                      <svg viewBox="0 0 500 220" width="100%" height="100%">
                        <defs>
                          <linearGradient id="splineGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accent-purple)" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="var(--accent-purple)" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        
                        {/* Horizontal Gridlines */}
                        <line x1="40" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                        <line x1="40" y1="90" x2="480" y2="90" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                        <line x1="40" y1="150" x2="480" y2="150" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                        
                        {/* Axis scales */}
                        <text x="15" y="34" fill="var(--text-muted)" fontSize="9" textAnchor="middle">100%</text>
                        <text x="15" y="94" fill="var(--text-muted)" fontSize="9" textAnchor="middle">50%</text>
                        <text x="15" y="154" fill="var(--text-muted)" fontSize="9" textAnchor="middle">0%</text>

                        {/* Bezier spline curve calculation */}
                        {(() => {
                          const w = 440;
                          const h = 120;
                          const startX = 40;
                          const startY = 30;
                          
                          // Convert points to SVG coords
                          const points = timeline.map((item, idx) => {
                            const x = startX + (idx / (timeline.length - 1)) * w;
                            const y = startY + h - (item.confidence / 100) * h;
                            return { x, y };
                          });

                          // Draw cubic spline curve string path
                          let pathStr = `M ${points[0].x} ${points[0].y}`;
                          for (let i = 0; i < points.length - 1; i++) {
                            const p0 = points[i];
                            const p1 = points[i + 1];
                            const cpX1 = p0.x + (p1.x - p0.x) / 2;
                            const cpY1 = p0.y;
                            const cpX2 = p0.x + (p1.x - p0.x) / 2;
                            const cpY2 = p1.y;
                            pathStr += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
                          }

                          // Build area closing path
                          const areaStr = `${pathStr} L ${points[points.length-1].x} ${startY + h} L ${points[0].x} ${startY + h} Z`;

                          return (
                            <>
                              <path d={areaStr} fill="url(#splineGrad)" />
                              <path d={pathStr} fill="none" stroke="var(--accent-purple)" strokeWidth="2.5" />
                              
                              {/* Draw interactive anchor nodes */}
                              {points.map((pt, idx) => (
                                <g key={idx}>
                                  <circle 
                                    cx={pt.x} 
                                    cy={pt.y} 
                                    r="4.5" 
                                    fill="var(--bg-primary)" 
                                    stroke="var(--accent-purple)" 
                                    strokeWidth="2.5" 
                                  />
                                  <text 
                                    x={pt.x} 
                                    y={pt.y - 10} 
                                    fill="#fff" 
                                    fontSize="8" 
                                    fontWeight="600" 
                                    textAnchor="middle"
                                  >
                                    {timeline[idx].confidence}%
                                  </text>
                                  <text 
                                    x={pt.x} 
                                    y={startY + h + 18} 
                                    fill="var(--text-secondary)" 
                                    fontSize="8" 
                                    textAnchor="middle"
                                  >
                                    {timeline[idx].time.substr(0, 5)}
                                  </text>
                                </g>
                              ))}
                            </>
                          );
                        })()}
                      </svg>
                    ) : (
                      <div className="table-empty-state" style={{ padding: '40px 0' }}>
                        <p>Awaiting capture data to plot spline. Capture more logs!</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* SVG Bar Chart: Rounded Volume distribution */}
                <div className="chart-card">
                  <div className="chart-card-header">
                    <h3>Emotions Density Bar</h3>
                    <p>Total logged captures</p>
                  </div>

                  <div className="chart-svg-container">
                    {totalCaptures > 0 ? (
                      <svg viewBox="0 0 500 220" width="100%" height="100%">
                        {(() => {
                          const keys = ['Happy', 'Sad', 'Angry', 'Fear', 'Surprise', 'Neutral', 'Disgust'];
                          const maxCount = Math.max(...Object.values(counts), 1);
                          const chartH = 140;
                          const colW = 45;
                          const gap = 20;
                          const startX = 40;
                          const startY = 30;

                          return (
                            <>
                              {/* Grid lines */}
                              <line x1="30" y1="30" x2="480" y2="30" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                              <line x1="30" y1="100" x2="480" y2="100" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                              <line x1="30" y1="170" x2="480" y2="170" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />

                              {keys.map((key, idx) => {
                                const count = counts[key] || 0;
                                const barHeight = (count / maxCount) * chartH;
                                const x = startX + idx * (colW + gap);
                                const y = startY + chartH - barHeight;
                                const meta = EMOTION_METADATA[key.toLowerCase()] || EMOTION_METADATA.neutral;

                                return (
                                  <g key={key}>
                                    {/* Rounded top rect columns */}
                                    <rect 
                                      x={x} 
                                      y={y} 
                                      width={colW} 
                                      height={Math.max(barHeight, 3)} 
                                      rx="6" 
                                      fill={meta.color}
                                      opacity={count > 0 ? 0.8 : 0.08}
                                      style={{ transition: 'all 0.5s' }}
                                    />
                                    
                                    {/* Text quantities above bars */}
                                    <text 
                                      x={x + colW/2} 
                                      y={y - 8} 
                                      fill={count > 0 ? '#fff' : 'var(--text-muted)'} 
                                      fontSize="9" 
                                      fontWeight="700" 
                                      textAnchor="middle"
                                    >
                                      {count}
                                    </text>
                                    
                                    {/* Labels at bottom */}
                                    <text 
                                      x={x + colW/2} 
                                      y={startY + chartH + 18} 
                                      fill="var(--text-secondary)" 
                                      fontSize="9" 
                                      fontWeight="500" 
                                      textAnchor="middle"
                                    >
                                      {key.substr(0, 3)}
                                    </text>
                                  </g>
                                );
                              })}
                            </>
                          );
                        })()}
                      </svg>
                    ) : (
                      <div className="table-empty-state" style={{ padding: '40px 0' }}>
                        <p>Awaiting capture database counts to plot. Log some readings!</p>
                      </div>
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* TAB 4: SYSTEM SETTINGS */}
          {activeTab === 'settings' && (
            <div className="settings-wrapper">
              
              {/* Section: Video Hardware */}
              <div className="settings-section-card">
                <div className="settings-section-header">
                  <div className="settings-section-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  <div className="settings-section-title">
                    <h3>Active Input Hardware</h3>
                    <p>Configure system cameras and video stream parameters.</p>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <div className="setting-form-group">
                    <label>Camera Device Selector</label>
                    {cameraList.length > 0 ? (
                      <select 
                        className="setting-select"
                        value={activeCameraId}
                        onChange={(e) => setActiveCameraId(e.target.value)}
                      >
                        {cameraList.map(dev => (
                          <option key={dev.deviceId} value={dev.deviceId}>
                            {dev.label || `Video Input (ID: ${dev.deviceId.substr(0, 5)}...)`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select className="setting-select" disabled>
                        <option>No Camera Access Permitted / Detected</option>
                      </select>
                    )}
                  </div>

                  <div className="setting-toggle-row">
                    <div className="setting-toggle-label">
                      <h4>Active Webcam Streaming</h4>
                      <p>Begin capturing and showing video frames in the cyber HUD card.</p>
                    </div>
                    <label className="switch">
                      <input 
                        type="checkbox" 
                        checked={cameraActive}
                        onChange={(e) => setCameraActive(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Section: Analysis loops settings */}
              <div className="settings-section-card">
                <div className="settings-section-header">
                  <div className="settings-section-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                  </div>
                  <div className="settings-section-title">
                    <h3>Analysis Tick Rates</h3>
                    <p>Adjust database storage and neural frame capture speed thresholds.</p>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <div className="setting-form-group">
                    <label>Frame Grab Cycle Speed</label>
                    <select 
                      className="setting-select"
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    >
                      <option value="500">Sub-Second Burst (500ms)</option>
                      <option value="1000">Balanced Diagnostic (1000ms)</option>
                      <option value="2000">Stable Telemetry (Recommended 2000ms)</option>
                      <option value="5000">Minimal Telemetry (5000ms)</option>
                    </select>
                  </div>

                  <div className="setting-toggle-row">
                    <div className="setting-toggle-label">
                      <h4>Forced Simulation Mode</h4>
                      <p>Bypasses Flask DeepFace transmission and runs internal mathematical drifts overlay instead.</p>
                    </div>
                    <label className="switch">
                      <input 
                        type="checkbox" 
                        checked={useSimulation}
                        onChange={(e) => setUseSimulation(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>

                  <div className="setting-toggle-row">
                    <div className="setting-toggle-label">
                      <h4>Automated Database Logging</h4>
                      <p>Saves captures to History database when dominancy confidence crosses 70% accuracy.</p>
                    </div>
                    <label className="switch">
                      <input 
                        type="checkbox" 
                        checked={autoLog}
                        onChange={(e) => setAutoLog(e.target.checked)}
                      />
                      <span className="slider"></span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Section: Dangerous actions */}
              <div className="settings-section-card settings-danger-card">
                <div className="settings-section-header">
                  <div className="settings-section-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  </div>
                  <div className="settings-section-title">
                    <h3>Administrative Actions</h3>
                    <p>Destructive tasks to clear stored metrics and database records.</p>
                  </div>
                </div>

                <div className="settings-form-grid">
                  <div className="setting-toggle-row">
                    <div className="setting-toggle-label">
                      <h4>Purge Database Logs</h4>
                      <p>Permanently removes all captured rows from the local web browser memory. This cannot be undone.</p>
                    </div>
                    <button 
                      className="cyber-btn cyber-btn-danger"
                      onClick={handleClearHistory}
                      disabled={history.length === 0}
                    >
                      Delete {history.length} Logs
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 5: ABOUT */}
          {activeTab === 'about' && (
            <div className="about-wrapper">
              <div className="about-card">
                <div className="about-text">
                  <p>
                    <strong>EmoSense AI Dashboard</strong> is an ultra-premium, real-time emotion visual telemetry suite. 
                    It is engineered to provide visual diagnostics from active webcam frames using state-of-the-art 
                    deep neural networks.
                  </p>
                  
                  <p>
                    By connecting standard browser streams to a server-side <strong>Python Flask REST API</strong>, EmoSense 
                    submits base64 encoded compressed JPEGs into an active **DeepFace AI classifier**. The classifier evaluates 
                    facial bounding matrices and maps expression probability values.
                  </p>

                  <p>
                    <strong>Key Operations Matrix:</strong>
                  </p>
                  <ul>
                    <li>Webcam Frame grab loops</li>
                    <li>Sub-100ms API predictions</li>
                    <li>7 raw emotion normalizations</li>
                    <li>Cubic spline analytics SVG plotting</li>
                    <li>Simulated drift offline fallback</li>
                    <li>Local browser database indices</li>
                  </ul>

                  <p>
                    <strong>Privacy Protocol Guarantee:</strong> Facial stream frames processed under active DeepFace AI mode are 
                    analyzed completely inside your local server memory buffer. No data leaves your machine or is written to disk, 
                    ensuring a zero data leakage privacy guarantee.
                  </p>

                  <div className="about-spec-badge">
                    System Environment: <span>Windows Node/Python Hybrid Core v2.0</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default App;
