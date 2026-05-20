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

# Enable CORS for frontend connection
CORS(app, resources={r"/api/*": {"origins": "*"}})

@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        "status": "ready",
        "model": "Emotion Model (VGG-Face)",
        "engine": "DeepFace"
    }), 200


@app.route('/api/analyze', methods=['POST'])
def analyze_emotion():

    data = request.get_json()

    if not data or 'image' not in data:
        return jsonify({
            "success": False,
            "error": "No image payload received."
        }), 400

    base64_str = data['image']

    try:

        # Remove base64 header if present
        if ',' in base64_str:
            base64_str = base64_str.split(',')[1]

        # Decode image
        img_data = base64.b64decode(base64_str)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            return jsonify({
                "success": False,
                "error": "Could not decode image."
            }), 400

        # Face detection
        try:
            faces = DeepFace.extract_faces(
                img_path=img,
                detector_backend='opencv',
                align=True,
                enforce_detection=False
            )
        except Exception as detect_err:
            print(f"Face extraction warning: {detect_err}", file=sys.stderr)
            faces = []

        preprocessed_face = img
        skip_detection = False

        if len(faces) > 0:

            primary_face = max(
                faces,
                key=lambda f: f['facial_area']['w'] * f['facial_area']['h']
            )

            h_img, w_img, _ = img.shape
            area = primary_face['facial_area']

            if not (
                area['x'] == 0 and
                area['y'] == 0 and
                area['w'] == w_img and
                area['h'] == h_img
            ):

                face_img = primary_face['face']

                if face_img.dtype != np.uint8:
                    face_img = (face_img * 255).astype(np.uint8)

                # Improve lighting using CLAHE
                gray = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)

                clahe = cv2.createCLAHE(
                    clipLimit=2.0,
                    tileGridSize=(8, 8)
                )

                equalized = clahe.apply(gray)

                preprocessed_face = cv2.cvtColor(
                    equalized,
                    cv2.COLOR_GRAY2BGR
                )

                skip_detection = True

        # Emotion analysis
        if skip_detection:

            results = DeepFace.analyze(
                img_path=preprocessed_face,
                actions=['emotion'],
                enforce_detection=False,
                detector_backend='skip'
            )

        else:

            results = DeepFace.analyze(
                img_path=preprocessed_face,
                actions=['emotion'],
                enforce_detection=False
            )

        if isinstance(results, list):
            analysis = results[0]
        else:
            analysis = results

        raw_emotions = analysis.get('emotion', {})

        supported_keys = [
            'happy',
            'sad',
            'angry',
            'fear',
            'surprise',
            'neutral',
            'disgust'
        ]

        total_val = sum(
            float(raw_emotions.get(k, 0))
            for k in supported_keys
        )

        if total_val > 0:

            emotions_normalized = {
                k: round(
                    (float(raw_emotions.get(k, 0)) / total_val) * 100
                )
                for k in supported_keys
            }

        else:

            emotions_normalized = {
                k: 0 for k in supported_keys
            }

            emotions_normalized['neutral'] = 100

        running_sum = sum(emotions_normalized.values())

        if running_sum != 100:

            diff = 100 - running_sum

            dominant_key = max(
                emotions_normalized,
                key=emotions_normalized.get
            )

            emotions_normalized[dominant_key] = max(
                0,
                emotions_normalized[dominant_key] + diff
            )

        dominant_emotion = max(
            emotions_normalized,
            key=emotions_normalized.get
        )

        confidence = emotions_normalized[dominant_emotion]

        return jsonify({
            "success": True,
            "dominant_emotion": dominant_emotion,
            "confidence": confidence,
            "emotions": emotions_normalized
        }), 200

    except Exception as e:

        print(f"DeepFace processing error: {e}", file=sys.stderr)

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


if __name__ == '__main__':

    print("--------------------------------------------------")
    print("EmoSense AI - Booting DeepFace Classification Engine...")
    print("Pre-warming model parameters...")
    
    try:

        dummy_img = np.zeros((100, 100, 3), dtype=np.uint8)

        DeepFace.analyze(
            img_path=dummy_img,
            actions=['emotion'],
            enforce_detection=False
        )

        DeepFace.extract_faces(
            img_path=dummy_img,
            detector_backend='opencv',
            enforce_detection=False
        )

        print("Model warm-up completed successfully!")

    except Exception as err:

        print(f"Warning: Warmup failed: {err}")

    print("--------------------------------------------------")

    # Render deployment compatible
    port = int(os.environ.get("PORT", 5000))

    app.run(
        host='0.0.0.0',
        port=port,
        debug=False
    )