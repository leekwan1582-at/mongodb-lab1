Here is the exact setup and JSON payload to test **Screenshot 10 (`POST /ai/entries`)** using **Advanced REST Client (ARC) by MuleSoft**, formatted for your `tracediary` database.

---

### 1. ARC Request Configuration

* **Method**: `POST`
* **URL**: `http://localhost:3000/ai/entries` *(or your deployed Render URL)*
* **Headers**:
* `Content-Type`: `application/json`
* `Authorization`: `Bearer <YOUR_JWT_TOKEN>` *(obtained from `POST /login`)*


* **Body** (Select `Raw input` / `application/json`):

```json
{
  "logText": "2026.11.05 09:15:22.401 Trades '1084291': failed market buy 0.50 EURUSD sl: 1.0820 tp: 1.0950 [Trade disabled / Off quotes at market opening]\n2026.11.05 09:15:22.405 ExpertAdvisor (EURUSD,M5): OrderSend error 4756 (TRADE_RETCODE_OFFQUOTES) during high-impact news event. Connection to broker bridge dropped packets. rates_total = 0."
}

```

---

### 2. Expected Response in ARC (`201 Created`)

When you click **Send**, ARC will display `Status: 201 Created` with a response payload structured like this:

```json
{
  "message": "AI triage completed and troubleshooting log created",
  "entryId": "67298a1c9f4d1e2b8c5a6789",
  "entry": {
    "title": "Trade disabled with error 4756 (TRADE_RETCODE_OFFQUOTES)",
    "symptom": "Failed market buy order with error 4756 and dropped broker bridge connection during news event",
    "tried": "Automated stack trace parsed via Gemini LLM",
    "rootCause": "Execution halted due to off-quotes condition and empty rates buffer at market opening",
    "fix": "Implement retry logic with exponential backoff and verify trade server quotes before invoking OrderSend",
    "lesson": "Never dispatch market orders during rollover or high-impact news without pre-checking server connection and quote freshness",
    "severity": "Critical",
    "tags": [
      "mql5",
      "ordersend",
      "offquotes",
      "execution"
    ],
    "createdAt": "2026-11-05T01:15:22.000Z",
    "environment": {
      "_id": "672989c49f4d1e2b8c5a6701",
      "name": "MQL5",
      "platform": "MetaTrader 5 Client Terminal"
    },
    "auditTrail": [
      {
        "attemptId": "67298a1c9f4d1e2b8c5a678a",
        "actionTaken": "AI Diagnostic Analysis",
        "outcome": "Extracted root cause and suggested remediation",
        "timestamp": "2026-11-05T01:15:22.000Z",
        "recordedBy": "alex.quant@tracediary.io"
      }
    ]
  }
}

```

---

### 3. Screenshot Checklist for ARC

To ensure full marks in the assessment criteria, make sure your screenshot clearly captures:

1. **The top bar**: `POST` method badge and URL `http://localhost:3000/ai/entries`.
2. **The Headers / Auth tab**: `Authorization: Bearer eyJhbGci...` visible.
3. **The Body tab**: The raw `logText` JSON payload shown above.
4. **The Response panel**: Status badge showing `201 Created`, response time, and the returned JSON body with the parsed `title`, `rootCause`, `severity`, `environment`, and `auditTrail`.