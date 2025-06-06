import { promises as fs } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { stringify, parse } from 'yaml';

interface StateExportOptions {
  outputPath?: string;
  services: string[];
  includeData?: boolean;
}

interface StateExportResult {
  version: string;
  timestamp: string;
  services: Record<string, any>;
  metadata: {
    localstackVersion: string;
    exportedServices: string[];
    totalResources: number;
  };
}

export class StateManager {
  private readonly LOCALSTACK_ENDPOINT = 'http://localhost:4566';

  async exportState(options: StateExportOptions): Promise<any> {
    try {
      const exportResult = await this.performStateExport(options);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            exportPath: exportResult.path,
            summary: exportResult.summary,
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            troubleshooting: this.getExportTroubleshootingTips(),
          }, null, 2)
        }]
      };
    }
  }

  async importState(statePath: string): Promise<any> {
    try {
      const importResult = await this.performStateImport(statePath);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            summary: importResult.summary,
            recommendations: importResult.recommendations,
          }, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            troubleshooting: this.getImportTroubleshootingTips(),
          }, null, 2)
        }]
      };
    }
  }

  private async performStateExport(options: StateExportOptions): Promise<{ path: string; summary: any }> {
    const { outputPath, services, includeData = true } = options;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const defaultPath = `localstack-state-${timestamp}.yml`;
    const exportPath = outputPath || defaultPath;

    const stateData: StateExportResult = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      services: {},
      metadata: {
        localstackVersion: await this.getLocalStackVersion(),
        exportedServices: services,
        totalResources: 0,
      },
    };

    let totalResources = 0;

    // Export each service's state
    for (const service of services) {
      const serviceState = await this.exportServiceState(service, includeData);
      if (serviceState) {
        stateData.services[service] = serviceState;
        totalResources += serviceState.resourceCount || 0;
      }
    }

    stateData.metadata.totalResources = totalResources;

    // Write to file
    const yamlContent = stringify(stateData);
    await fs.writeFile(exportPath, yamlContent, 'utf8');

    // Generate export summary
    const summary = {
      exportPath,
      servicesExported: services.length,
      totalResources,
      fileSize: (await fs.stat(exportPath)).size,
      recommendations: this.generateExportRecommendations(stateData),
    };

    return { path: exportPath, summary };
  }

  private async performStateImport(statePath: string): Promise<{ summary: any; recommendations: string[] }> {
    // Read and parse state file
    const stateContent = await fs.readFile(statePath, 'utf8');
    const stateData: StateExportResult = parse(stateContent);

    const importSummary = {
      version: stateData.version,
      originalTimestamp: stateData.timestamp,
      servicesFound: Object.keys(stateData.services),
      totalResources: stateData.metadata.totalResources,
      importedResources: 0,
      skippedResources: 0,
      errors: [] as string[],
    };

    // Validate LocalStack is available
    await this.validateLocalStackConnectivity();

    // Import each service's state
    for (const [service, serviceState] of Object.entries(stateData.services)) {
      try {
        const result = await this.importServiceState(service, serviceState);
        importSummary.importedResources += result.imported;
        importSummary.skippedResources += result.skipped;
      } catch (error) {
        const errorMsg = `Failed to import ${service}: ${error instanceof Error ? error.message : error}`;
        importSummary.errors.push(errorMsg);
      }
    }

    const recommendations = this.generateImportRecommendations(importSummary, stateData);

    return { summary: importSummary, recommendations };
  }

  private async exportServiceState(service: string, includeData: boolean): Promise<any> {
    switch (service.toLowerCase()) {
      case 's3':
        return await this.exportS3State(includeData);
      case 'dynamodb':
        return await this.exportDynamoDBState(includeData);
      case 'sqs':
        return await this.exportSQSState();
      case 'sns':
        return await this.exportSNSState();
      case 'lambda':
        return await this.exportLambdaState();
      default:
        return null;
    }
  }

  private async exportS3State(includeData: boolean): Promise<any> {
    const buckets = await this.makeLocalStackRequest('GET', '/');
    const bucketList = buckets.data;
    
    const s3State = {
      buckets: [] as any[],
      resourceCount: 0,
    };

    if (bucketList.ListAllMyBucketsResult?.Buckets?.Bucket) {
      const bucketsArray = Array.isArray(bucketList.ListAllMyBucketsResult.Buckets.Bucket) 
        ? bucketList.ListAllMyBucketsResult.Buckets.Bucket 
        : [bucketList.ListAllMyBucketsResult.Buckets.Bucket];

      for (const bucket of bucketsArray) {
        const bucketInfo: any = {
          name: bucket.Name,
          creationDate: bucket.CreationDate,
          objects: [],
        };

        if (includeData) {
          try {
            const objects = await this.makeLocalStackRequest('GET', `/${bucket.Name}`);
            // Extract object information without actual data
            bucketInfo.objects = this.extractS3ObjectMetadata(objects.data);
          } catch {
            // Bucket might be empty or inaccessible
          }
        }

        s3State.buckets.push(bucketInfo);
        s3State.resourceCount++;
      }
    }

    return s3State;
  }

  private async exportDynamoDBState(includeData: boolean): Promise<any> {
    try {
      const tables = await this.makeLocalStackRequest('POST', '/', {
        'X-Amz-Target': 'DynamoDB_20120810.ListTables',
        'Content-Type': 'application/x-amz-json-1.0',
      }, {});

      const dynamoState = {
        tables: [] as any[],
        resourceCount: 0,
      };

      if (tables.data.TableNames) {
        for (const tableName of tables.data.TableNames) {
          const tableInfo = await this.getDynamoDBTableInfo(tableName, includeData);
          dynamoState.tables.push(tableInfo);
          dynamoState.resourceCount++;
        }
      }

      return dynamoState;
    } catch {
      return { tables: [], resourceCount: 0 };
    }
  }

  private async exportSQSState(): Promise<any> {
    try {
      const queues = await this.makeLocalStackRequest('POST', '/', {}, {
        Action: 'ListQueues',
        Version: '2012-11-05',
      });

      return {
        queues: queues.data.ListQueuesResult?.QueueUrl || [],
        resourceCount: queues.data.ListQueuesResult?.QueueUrl?.length || 0,
      };
    } catch {
      return { queues: [], resourceCount: 0 };
    }
  }

  private async exportSNSState(): Promise<any> {
    try {
      const topics = await this.makeLocalStackRequest('POST', '/', {}, {
        Action: 'ListTopics',
        Version: '2010-03-31',
      });

      return {
        topics: topics.data.ListTopicsResult?.Topics || [],
        resourceCount: topics.data.ListTopicsResult?.Topics?.length || 0,
      };
    } catch {
      return { topics: [], resourceCount: 0 };
    }
  }

  private async exportLambdaState(): Promise<any> {
    try {
      const functions = await this.makeLocalStackRequest('GET', '/2015-03-31/functions', {}, {});

      return {
        functions: functions.data.Functions?.map((fn: any) => ({
          functionName: fn.FunctionName,
          runtime: fn.Runtime,
          handler: fn.Handler,
          description: fn.Description,
          timeout: fn.Timeout,
          memorySize: fn.MemorySize,
        })) || [],
        resourceCount: functions.data.Functions?.length || 0,
      };
    } catch {
      return { functions: [], resourceCount: 0 };
    }
  }

  private async importServiceState(service: string, serviceState: any): Promise<{ imported: number; skipped: number }> {
    switch (service.toLowerCase()) {
      case 's3':
        return await this.importS3State(serviceState);
      case 'dynamodb':
        return await this.importDynamoDBState(serviceState);
      case 'sqs':
        return await this.importSQSState(serviceState);
      case 'sns':
        return await this.importSNSState(serviceState);
      case 'lambda':
        return await this.importLambdaState(serviceState);
      default:
        return { imported: 0, skipped: 0 };
    }
  }

  private async importS3State(s3State: any): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const bucket of s3State.buckets || []) {
      try {
        await this.makeLocalStackRequest('PUT', `/${bucket.name}`);
        imported++;
      } catch {
        skipped++;
      }
    }

    return { imported, skipped };
  }

  private async importDynamoDBState(dynamoState: any): Promise<{ imported: number; skipped: number }> {
    // Implementation would recreate DynamoDB tables based on stored schema
    // This is a simplified version
    return { imported: 0, skipped: dynamoState.tables?.length || 0 };
  }

  private async importSQSState(sqsState: any): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const queueUrl of sqsState.queues || []) {
      try {
        const queueName = queueUrl.split('/').pop();
        await this.makeLocalStackRequest('POST', '/', {}, {
          Action: 'CreateQueue',
          QueueName: queueName,
          Version: '2012-11-05',
        });
        imported++;
      } catch {
        skipped++;
      }
    }

    return { imported, skipped };
  }

  private async importSNSState(snsState: any): Promise<{ imported: number; skipped: number }> {
    // Implementation would recreate SNS topics
    return { imported: 0, skipped: snsState.topics?.length || 0 };
  }

  private async importLambdaState(lambdaState: any): Promise<{ imported: number; skipped: number }> {
    // Implementation would recreate Lambda functions (requires function code)
    return { imported: 0, skipped: lambdaState.functions?.length || 0 };
  }

  private async makeLocalStackRequest(method: string, path: string, headers: any = {}, data?: any): Promise<any> {
    const url = `${this.LOCALSTACK_ENDPOINT}${path}`;
    return await axios({
      method,
      url,
      headers: {
        'Authorization': 'AWS4-HMAC-SHA256 Credential=test/20220101/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=test',
        ...headers,
      },
      data,
    });
  }

  private async getLocalStackVersion(): Promise<string> {
    try {
      const health = await axios.get(`${this.LOCALSTACK_ENDPOINT}/_localstack/health`);
      return health.data.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async validateLocalStackConnectivity(): Promise<void> {
    try {
      await axios.get(`${this.LOCALSTACK_ENDPOINT}/_localstack/health`, { timeout: 5000 });
    } catch {
      throw new Error('LocalStack is not accessible. Ensure container is running and healthy.');
    }
  }

  private extractS3ObjectMetadata(listObjectsResult: any): any[] {
    // Extract object metadata without downloading actual content
    const contents = listObjectsResult.ListBucketResult?.Contents;
    if (!contents) return [];
    
    const objectsArray = Array.isArray(contents) ? contents : [contents];
    return objectsArray.map((obj: any) => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified,
      etag: obj.ETag,
    }));
  }

  private async getDynamoDBTableInfo(tableName: string, includeData: boolean): Promise<any> {
    try {
      const tableDesc = await this.makeLocalStackRequest('POST', '/', {
        'X-Amz-Target': 'DynamoDB_20120810.DescribeTable',
        'Content-Type': 'application/x-amz-json-1.0',
      }, { TableName: tableName });

      return {
        tableName,
        schema: tableDesc.data.Table,
        itemCount: includeData ? await this.getDynamoDBItemCount(tableName) : 0,
      };
    } catch {
      return { tableName, schema: null, itemCount: 0 };
    }
  }

  private async getDynamoDBItemCount(tableName: string): Promise<number> {
    try {
      const scan = await this.makeLocalStackRequest('POST', '/', {
        'X-Amz-Target': 'DynamoDB_20120810.Scan',
        'Content-Type': 'application/x-amz-json-1.0',
      }, { TableName: tableName, Select: 'COUNT' });

      return scan.data.Count || 0;
    } catch {
      return 0;
    }
  }

  private generateExportRecommendations(stateData: StateExportResult): string[] {
    const recommendations = [];
    
    if (stateData.metadata.totalResources === 0) {
      recommendations.push('No resources found - ensure LocalStack services are running and populated');
    }
    
    if (stateData.metadata.totalResources > 100) {
      recommendations.push('Large state export - consider splitting by service for better performance');
    }
    
    recommendations.push('Share this file with team members to replicate the environment');
    recommendations.push('Store in version control to track environment changes');
    
    return recommendations;
  }

  private generateImportRecommendations(summary: any, stateData: StateExportResult): string[] {
    const recommendations = [];
    
    if (summary.errors.length > 0) {
      recommendations.push('Some resources failed to import - check LocalStack logs for details');
    }
    
    if (summary.skippedResources > 0) {
      recommendations.push('Some resources were skipped - they may already exist or require manual creation');
    }
    
    if (stateData.version !== '1.0') {
      recommendations.push('State file version mismatch - some features may not work correctly');
    }
    
    recommendations.push('Verify imported resources match your expectations');
    recommendations.push('Test application functionality after import');
    
    return recommendations;
  }

  private getExportTroubleshootingTips(): string[] {
    return [
      'Ensure LocalStack is running and accessible',
      'Check that specified services are enabled',
      'Verify sufficient disk space for export file',
      'Ensure write permissions for output directory',
    ];
  }

  private getImportTroubleshootingTips(): string[] {
    return [
      'Verify state file exists and is readable',
      'Ensure LocalStack is running and healthy',
      'Check that target services are enabled',
      'Clear existing resources if conflicts occur',
    ];
  }
}