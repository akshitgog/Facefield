# Production AWS Sync & Purge Architecture

This document outlines how to transition the **Hackathon Demo Sync & Purge** mechanism into a fully robust, production-ready system deployed on AWS. 

## 1. The Challenge (Offline-First Remote Operation)
In remote zero-network zones, the Datalake 3.0 app will accumulate attendance records locally (in SQLite or AsyncStorage). If left unmanaged, this will eventually consume all available device storage and pose a security risk if the device is lost.

The solution is a **Sync & Purge Mechanism**: 
- Detect when internet is restored.
- Securely upload (Sync) the records to the cloud.
- Delete (Purge) the local copy to free up space.

---

## 2. Recommended AWS Architecture

### A. AWS Services Used
1. **Amazon API Gateway:** Exposes a secure REST or GraphQL API endpoint (`POST /sync-attendance`).
2. **AWS Lambda:** Serverless compute to process incoming data, validate JWT tokens, and format the data.
3. **Amazon DynamoDB (or RDS PostgreSQL):** Highly scalable database to permanently store the synced attendance logs.
4. **Amazon Cognito:** Manages user authentication and issues secure JWT tokens.

### B. Mobile App Components (React Native)
1. **`@react-native-community/netinfo`:** Monitors network status in real-time.
2. **`react-native-background-actions` or `WorkManager`:** Allows the app to sync data in the background even if the app is closed when the network returns.
3. **Local SQLite DB:** Stores offline records with a boolean flag: `synced: false`.

---

## 3. The Production Workflow

### Step 1: Accumulating Offline Data
When a user marks attendance in a zero-network zone, the app writes to the local DB:
```json
{
  "id": "12345",
  "userId": "USER_01",
  "status": "present",
  "entryTime": "08:30 AM",
  "date": "2026-06-05",
  "synced": false  // <-- CRITICAL FLAG
}
```

### Step 2: Triggering the Sync
When the device connects to WiFi or 4G/5G, the background worker wakes up:
1. It queries the local DB: `SELECT * FROM attendance WHERE synced = false`.
2. It packages these records into an array.
3. It makes an authenticated `POST` request to the **AWS API Gateway**.

### Step 3: AWS Processing
1. The **AWS API Gateway** verifies the user's Cognito JWT.
2. **AWS Lambda** receives the batch array of records.
3. Lambda performs duplicate checks and inserts the records into **DynamoDB**.
4. Lambda responds to the mobile app with a `200 OK` and an array of successfully saved IDs.

### Step 4: The Purge (Local Cleanup)
When the React Native app receives the `200 OK` response, it executes the **Purge**:
```javascript
// 1. Mark as synced locally (Safety net)
await db.execute('UPDATE attendance SET synced = true WHERE id IN (?)', [successfulIds]);

// 2. PURGE the synced records from the device
await db.execute('DELETE FROM attendance WHERE synced = true');
```
*Why this matters:* By explicitly deleting the records, the device storage footprint remains minimal (under 20MB) and sensitive data is removed from the local edge device, ensuring high security and sustainability.

---

## 4. Implementation Example (React Native -> AWS)

Here is a pseudo-code implementation for the production client:

```typescript
import NetInfo from "@react-native-community/netinfo";

// Listener triggers automatically when network connects
NetInfo.addEventListener(state => {
  if (state.isConnected && state.isInternetReachable) {
    runProductionSyncAndPurge();
  }
});

async function runProductionSyncAndPurge() {
  const unsyncedRecords = await getUnsyncedFromSQLite();
  if (unsyncedRecords.length === 0) return;

  try {
    // Sync to AWS API Gateway
    const response = await fetch('https://api.your-aws-region.amazonaws.com/sync', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${await getCognitoToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ records: unsyncedRecords })
    });

    if (response.ok) {
      const { syncedIds } = await response.json();
      
      // PURGE locally to free space
      await deleteFromSQLite(syncedIds);
      console.log(`Successfully synced and purged ${syncedIds.length} records.`);
    }
  } catch (error) {
    console.error("AWS Sync failed, will retry next time network is available.");
  }
}
```

## 5. Security & Edge Cases
- **Power Loss during Sync:** Use SQL Transactions. Only `DELETE` the local records *after* AWS confirms receipt. If the phone dies mid-sync, the `synced: false` flag remains, and it will retry next time.
- **Data Tampering:** The local SQLite database can be encrypted using `react-native-sqlcipher` to prevent users from altering their offline entry times before the AWS sync occurs.
