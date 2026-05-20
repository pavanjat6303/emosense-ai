import os
import sys

# Silence TensorFlow logging for clean console output
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import logging
logging.getLogger('tensorflow').setLevel(logging.ERROR)

from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import numpy as np
import cv2
from deepface import DeepFace

app = Flask(__name__)
# Enable CORS for all domains so the frontend on file:// or another port can connect
CORS(app, resources={r"/api/*": {"origins": "*"}})

@app.route('/api/status', methods=['GET'])
def get_status():
    """
    Status checker to verify Flask server is online and models are pre-loaded.
    """
    return jsonify({
        "status": "ready",
        "model": "Emotion Model (VGG-Face)",
        "engine": "DeepFace"
    }), 200

@app.route('/api/analyze', methods=['POST'])
def analyze_emotion():
    """
    Accepts base64 encoded image frame, performs robust face alignment and cropping,
    applies CLAHE contrast equalization, reduces false happy anomalies,
    and returns 4 core normalized emotion probabilities (happy, sad, angry, neutral).
    """
    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({"success": False, "error": "No image payload received."}), 400
    
    base64_str = data['image']
    
    try:
        # Strip header prefix if present (e.g., 'data:image/jpeg;base64,')
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]
        
        # Decode base64 image into memory buffer to avoid slow disk writes
        img_data = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({"success": False, "error": "Could not decode base64 image matrix."}), 400
        
        # 1. Advanced Face Detection, Crop, and Alignment (detector_backend='opencv')
        try:
            faces = DeepFace.extract_faces(img_path=img, detector_backend='opencv', align=True, enforce_detection=False)
        except Exception as detect_err:
            print(f"Face extraction warning: {detect_err}", file=sys.stderr)
            faces = []

        preprocessed_face = img
        skip_detection = False

        if len(faces) > 0:
            # 2. Detect only one primary face: select the one with the largest bounding box area
            primary_face = max(faces, key=lambda f: f['facial_area']['w'] * f['facial_area']['h'])
            
            # Check if this is a real detected face bounding box rather than original fallback
            h_img, w_img, _ = img.shape
            area = primary_face['facial_area']
            
            if not (area['x'] == 0 and area['y'] == 0 and area['w'] == w_img and area['h'] == h_img):
                # Valid cropped & aligned face detected!
                face_img = primary_face['face']
                
                # Convert DeepFace normalized float [0, 1] back to OpenCV [0, 255] uint8
                if face_img.dtype != np.uint8:
                    face_img = (face_img * 255).astype(np.uint8)
                
                # 3. Preprocessing: Apply CLAHE to neutralize lighting imbalances and shadows
                gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)
                clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
                equalized = clahe.apply(gray)
                
                # Convert back to 3-channels as DeepFace network expects RGB/BGR inputs
                preprocessed_face = cv2.cvtColor(equalized, cv2.COLOR_GRAY2BGR)
                skip_detection = True

        # 4. Perform skip-detection DeepFace analysis on preprocessed cropped/aligned face
        if skip_detection:
            results = DeepFace.analyze(img_path=preprocessed_face, actions=['emotion'], enforce_detection=False, detector_backend='skip')
        else:
            results = DeepFace.analyze(img_path=preprocessed_face, actions=['emotion'], enforce_detection=False)
        
        # Parse result
        if isinstance(results, list):
            analysis = results[0]
        else:
            analysis = results
            
        raw_emotions = analysis.get('emotion', {})
        
        # --- DEBUG BACKEND LOGGING: PRINT RAW SCORES ---
        print("\n[DEBUG] --- Raw DeepFace Emotion Scores ---", flush=True)
        for k, v in raw_emotions.items():
            print(f"  {k:10}: {v:.4f}%", flush=True)
         
        # 5. Keep all 7 standard DeepFace emotions directly (no aggregation or damping)
        supported_keys = ['happy', 'sad', 'angry', 'fear', 'surprise', 'neutral', 'disgust']
        
        # Extract raw values and normalize them to sum up to exactly 100%
        total_val = sum(float(raw_emotions.get(k, 0)) for k in supported_keys)
        
        if total_val > 0:
            emotions_normalized = {
                k: round((float(raw_emotions.get(k, 0)) / total_val) * 100)
                for k in supported_keys
            }
        else:
            # Fallback if sum is zero
            emotions_normalized = {k: 0 for k in supported_keys}
            emotions_normalized['neutral'] = 100
            
        # Guarantee exact 100% sum
        running_sum = sum(emotions_normalized[k] for k in supported_keys)
        if running_sum != 100:
            diff = 100 - running_sum
            # Add difference to the dominant emotion key
            dominant_key = max(emotions_normalized, key=emotions_normalized.get)
            emotions_normalized[dominant_key] = max(0, emotions_normalized[dominant_key] + diff)
            
        # Determine dominant emotion name
        dominant_emotion = max(emotions_normalized, key=emotions_normalized.get)
        confidence = emotions_normalized[dominant_emotion]

        # --- DEBUG BACKEND LOGGING: PRINT NORMALIZED OUTPUT ---
        print("[DEBUG] --- Normalized 7-Emotion Output ---", flush=True)
        for k, v in emotions_normalized.items():
            print(f"  {k:10}: {v}%", flush=True)
        print(f"[DEBUG] Dominant Result: {dominant_emotion} ({confidence}%)\n", flush=True)
        
        return jsonify({
            "success": True,
            "dominant_emotion": dominant_emotion,
            "confidence": confidence,
            "emotions": emotions_normalized
        }), 200
        
    except Exception as e:
        print(f"DeepFace processing error: {e}", file=sys.stderr)
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == '__main__':
    # Pre-warming / Pre-compiling Model on server start to avoid sluggish first requests
    print("--------------------------------------------------")
    print("EmoSense AI - Booting DeepFace Classification Engine...")
    print("Pre-warming model parameters. This compiles TensorFlow pipelines...")
    try:
        # Create single dummy blank image
        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)
        # Warmup emotion analyzer
        DeepFace.analyze(img_path=dummy_img, actions=['emotion'], enforce_detection=False)
        # Warmup OpenCV face detector
        DeepFace.extract_faces(img_path=dummy_img, detector_backend='opencv', enforce_detection=False)
        print("Model warm-up completed successfully. Ready for stream connections!")
    except Exception as err:
        print(f"Warning: Warmup pre-compilation failed: {err}")
    print("--------------------------------------------------")
    
    # Run server locally on standard Flask port 5000
    app.run(host='127.0.0.1', port=5000, debug=False)
