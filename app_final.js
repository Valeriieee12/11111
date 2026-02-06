// Import Transformers.js for client-side ML
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/dist/transformers.min.js";

// Google Sheets URL - CONFIGURED
const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbyk3-wEI1sI5WmvflYV5CP0YsEklSV9NOuuGyPapa6V56PSefKYIHyLIf-ZhNXKmoR7/exec';

// Global state management
let datasetReviews = [];
let classifierModel = null;
let authToken = null;

// DOM element references
const UI = {
    statusBar: document.getElementById('statusMessage'),
    errorDisplay: document.getElementById('errorMessage'),
    runButton: document.getElementById('analyzeButton'),
    reviewContent: document.getElementById('reviewText'),
    outcomeBox: document.getElementById('resultBox'),
    outcomeIcon: document.getElementById('resultIcon'),
    outcomeTitle: document.getElementById('resultLabel'),
    outcomeDetails: document.getElementById('resultConfidence'),
    loadingIndicator: document.getElementById('loadingSpinner'),
    authInput: document.getElementById('apiTokenInput')
};

// Status Bar Management
function updateStatusBar(message, category = 'loading') {
    const icons = {
        loading: 'fa-spinner fa-pulse',
        success: 'fa-check-circle',
        danger: 'fa-exclamation-triangle'
    };
    
    UI.statusBar.innerHTML = `<i class="fas ${icons[category]}"></i><span>${message}</span>`;
    UI.statusBar.className = `alert-box alert-${category}`;
}

function showErrorMessage(text) {
    UI.errorDisplay.textContent = text;
    UI.errorDisplay.style.display = 'block';
    console.error('[ERROR]:', text);
}

function hideErrorMessage() {
    UI.errorDisplay.style.display = 'none';
}

// Data Loading Module
async function loadReviewDataset() {
    updateStatusBar('Fetching review dataset...', 'loading');
    
    try {
        const response = await fetch('reviews_test.tsv');
        
        if (!response.ok) {
            throw new Error(`Failed to fetch TSV: HTTP ${response.status}`);
        }
        
        const tsvContent = await response.text();
        
        return new Promise((resolve, reject) => {
            Papa.parse(tsvContent, {
                header: true,
                delimiter: '\t',
                skipEmptyLines: true,
                complete: (result) => {
                    if (result.errors.length > 0) {
                        console.warn('[TSV] Parse warnings:', result.errors);
                    }
                    
                    const cleanReviews = result.data
                        .map(entry => entry.text)
                        .filter(text => text && typeof text === 'string' && text.trim());
                    
                    if (cleanReviews.length === 0) {
                        reject(new Error('Dataset contains no valid reviews'));
                    } else {
                        console.log(`[Dataset] Loaded ${cleanReviews.length} entries`);
                        resolve(cleanReviews);
                    }
                },
                error: (parseError) => {
                    reject(new Error(`TSV parsing failed: ${parseError.message}`));
                }
            });
        });
    } catch (error) {
        showErrorMessage(`Dataset loading error: ${error.message}`);
        throw error;
    }
}

// AI Model Initialization
async function initializeClassifier() {
    try {
        updateStatusBar('Initializing AI classifier (may take ~60 seconds first time)...', 'loading');
        
        classifierModel = await pipeline(
            'text-classification',
            'Xenova/distilbert-base-uncased-finetuned-sst-2-english'
        );
        
        updateStatusBar('AI classifier ready! Click button to analyze.', 'success');
        console.log('[Model] Initialization complete');
        return true;
    } catch (error) {
        const errMsg = `Classifier initialization failed: ${error.message}`;
        updateStatusBar(errMsg, 'danger');
        showErrorMessage(errMsg);
        throw error;
    }
}

// Random Selection Helper
function selectRandomReview() {
    if (datasetReviews.length === 0) {
        throw new Error('No reviews available in dataset');
    }
    const randomIdx = Math.floor(Math.random() * datasetReviews.length);
    return datasetReviews[randomIdx];
}

// Sentiment Classification
async function runClassification(text) {
    if (!classifierModel) {
        throw new Error('Classifier not initialized');
    }
    
    const results = await classifierModel(text);
    return results[0];
}

// Result Interpretation
function interpretResult(prediction) {
    const { label, score } = prediction;
    
    if (label === 'POSITIVE' && score > 0.5) {
        return {
            type: 'positive',
            labelText: 'POSITIVE',
            scoreValue: score,
            iconSymbol: 'fa-thumbs-up'
        };
    } else if (label === 'NEGATIVE' && score > 0.5) {
        return {
            type: 'negative',
            labelText: 'NEGATIVE',
            scoreValue: score,
            iconSymbol: 'fa-thumbs-down'
        };
    } else {
        return {
            type: 'neutral',
            labelText: 'NEUTRAL',
            scoreValue: score,
            iconSymbol: 'fa-meh'
        };
    }
}

// UI Rendering
function renderOutcome(interpretation) {
    const { type, labelText, scoreValue, iconSymbol } = interpretation;
    
    UI.outcomeBox.className = `outcome-box ${type}`;
    UI.outcomeBox.style.display = 'block';
    
    UI.outcomeIcon.innerHTML = `<i class="fas ${iconSymbol}"></i>`;
    UI.outcomeTitle.textContent = labelText;
    
    const percentScore = (scoreValue * 100).toFixed(1);
    UI.outcomeDetails.textContent = `Confidence Score: ${percentScore}%`;
}

// Google Sheets Integration
async function sendToGoogleSheets(reviewText, label, confidence, context) {
    try {
        const timestamp = new Date().toISOString();
        
        const payload = {
            ts_iso: timestamp,
            event: 'sentiment_analysis',
            variant: 'A',
            userId: context.userId || 'anonymous',
            meta: JSON.stringify({
                url: context.url || window.location.href,
                userAgent: navigator.userAgent,
                sentiment: label,
                confidence: confidence
            }),
            review: reviewText,
            sentiment_label: label,
            sentiment_confidence: confidence
        };
        
        console.log('[Sheets] Sending data:', payload);
        
        const response = await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });
        
        console.log('[Sheets] Data sent successfully');
        
    } catch (error) {
        console.error('[Sheets] Error sending data:', error);
    }
}

// Main Execution Flow
async function executeAnalysis() {
    try {
        hideErrorMessage();
        
        if (datasetReviews.length === 0) {
            showErrorMessage('Dataset not loaded. Please refresh page.');
            return;
        }
        
        UI.runButton.disabled = true;
        UI.loadingIndicator.style.display = 'block';
        UI.outcomeBox.style.display = 'none';
        
        const selectedReview = selectRandomReview();
        UI.reviewContent.textContent = selectedReview;
        
        const prediction = await runClassification(selectedReview);
        const interpretation = interpretResult(prediction);
        
        renderOutcome(interpretation);
        
        await sendToGoogleSheets(
            selectedReview,
            interpretation.labelText,
            interpretation.scoreValue,
            {
                userId: `session-${Date.now()}`,
                url: window.location.href
            }
        );
        
    } catch (error) {
        showErrorMessage(`Analysis failed: ${error.message}`);
    } finally {
        UI.runButton.disabled = false;
        UI.loadingIndicator.style.display = 'none';
    }
}

// Application Bootstrap
async function bootstrapApplication() {
    try {
        datasetReviews = await loadReviewDataset();
        console.log(`[Bootstrap] Dataset ready: ${datasetReviews.length} reviews`);
        
        await initializeClassifier();
        
        UI.runButton.disabled = false;
        
    } catch (error) {
        console.error('[Bootstrap] Failed:', error);
        updateStatusBar('Application startup failed. Refresh to retry.', 'danger');
    }
}

// Event Bindings
UI.runButton.addEventListener('click', executeAnalysis);

UI.authInput.addEventListener('input', (evt) => {
    authToken = evt.target.value.trim();
    
    if (authToken) {
        localStorage.setItem('hf_api_token', authToken);
    }
});

// Application Entry Point
document.addEventListener('DOMContentLoaded', () => {
    const storedToken = localStorage.getItem('hf_api_token');
    if (storedToken) {
        UI.authInput.value = storedToken;
        authToken = storedToken;
    }
    
    bootstrapApplication();
});
