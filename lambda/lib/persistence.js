'use strict';

// Speichert die Favoriten pro Alexa-Nutzer.
//
// - Alexa-hosted Skill: Amazon legt eine DynamoDB-Tabelle an und setzt
//   DYNAMODB_PERSISTENCE_TABLE_NAME / DYNAMODB_PERSISTENCE_REGION.
// - Eigene Lambda: dieselben Umgebungsvariablen setzen, Tabelle mit
//   Partition Key "id" (String) anlegen.
// - Lokal/Tests: ohne Tabelle wird im Speicher gearbeitet.
//
// Das Tabellenformat ({ id, attributes }) entspricht dem des offiziellen
// ask-sdk-dynamodb-persistence-adapter. Wir nutzen das AWS SDK, das in der
// Lambda-Laufzeit ohnehin vorhanden ist (v3 ab Node 18, v2 bei Node 16),
// statt es mitzuliefern.

function userIdOf(requestEnvelope) {
  return requestEnvelope.context.System.user.userId;
}

function createDocumentClient(region) {
  try {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const lib = require('@aws-sdk/lib-dynamodb');
    const client = lib.DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    return {
      get: (params) => client.send(new lib.GetCommand(params)),
      put: (params) => client.send(new lib.PutCommand(params)),
      delete: (params) => client.send(new lib.DeleteCommand(params)),
    };
  } catch (e) {
    const AWS = require('aws-sdk');
    const client = new AWS.DynamoDB.DocumentClient({ region });
    return {
      get: (params) => client.get(params).promise(),
      put: (params) => client.put(params).promise(),
      delete: (params) => client.delete(params).promise(),
    };
  }
}

class DynamoDbAdapter {
  constructor({ tableName, region }) {
    this.tableName = tableName;
    this.region = region;
    this.client = null;
  }

  db() {
    if (!this.client) this.client = createDocumentClient(this.region);
    return this.client;
  }

  async getAttributes(requestEnvelope) {
    const res = await this.db().get({ TableName: this.tableName, Key: { id: userIdOf(requestEnvelope) }, ConsistentRead: true });
    return (res.Item && res.Item.attributes) || {};
  }

  async saveAttributes(requestEnvelope, attributes) {
    await this.db().put({ TableName: this.tableName, Item: { id: userIdOf(requestEnvelope), attributes } });
  }

  async deleteAttributes(requestEnvelope) {
    await this.db().delete({ TableName: this.tableName, Key: { id: userIdOf(requestEnvelope) } });
  }
}

class MemoryAdapter {
  constructor() {
    this.store = new Map();
  }

  async getAttributes(requestEnvelope) {
    return JSON.parse(JSON.stringify(this.store.get(userIdOf(requestEnvelope)) || {}));
  }

  async saveAttributes(requestEnvelope, attributes) {
    this.store.set(userIdOf(requestEnvelope), JSON.parse(JSON.stringify(attributes)));
  }

  async deleteAttributes(requestEnvelope) {
    this.store.delete(userIdOf(requestEnvelope));
  }
}

function createDefaultAdapter(env = process.env) {
  if (env.DYNAMODB_PERSISTENCE_TABLE_NAME) {
    return new DynamoDbAdapter({
      tableName: env.DYNAMODB_PERSISTENCE_TABLE_NAME,
      region: env.DYNAMODB_PERSISTENCE_REGION || env.AWS_REGION,
    });
  }
  console.warn('DYNAMODB_PERSISTENCE_TABLE_NAME fehlt – Favoriten werden nur im Speicher gehalten.');
  return new MemoryAdapter();
}

module.exports = { DynamoDbAdapter, MemoryAdapter, createDefaultAdapter };
