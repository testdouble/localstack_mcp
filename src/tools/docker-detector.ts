import Docker from 'dockerode';
import { promises as fs } from 'fs';
import { join } from 'path';

export class DockerDetector {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  async detectEnvironment(projectPath: string) {
    const results = {
      dockerAvailable: false,
      dockerComposeFound: false,
      locilStackContainer: null as any,
      networkMode: 'unknown',
      suggestedConfig: {} as any,
      issues: [] as string[],
    };

    try {
      // Check if Docker is available
      await this.docker.ping();
      results.dockerAvailable = true;
    } catch (error) {
      results.issues.push('Docker is not running or not accessible');
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    }

    // Check for docker-compose files
    const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    for (const file of composeFiles) {
      try {
        const filePath = join(projectPath, file);
        await fs.access(filePath);
        results.dockerComposeFound = true;
        
        // Read and analyze compose file
        const content = await fs.readFile(filePath, 'utf8');
        if (content.includes('localstack')) {
          results.suggestedConfig.existingComposeFile = file;
        }
        break;
      } catch {
        // File doesn't exist, continue
      }
    }

    // Check for existing LocalStack container
    try {
      const containers = await this.docker.listContainers({ all: true });
      const localstackContainer = containers.find((container: any) => 
        container.Names.some((name: string) => name.includes('localstack')) ||
        container.Image.includes('localstack')
      );

      if (localstackContainer) {
        results.locilStackContainer = {
          id: localstackContainer.Id,
          state: localstackContainer.State,
          status: localstackContainer.Status,
          ports: localstackContainer.Ports,
          names: localstackContainer.Names,
        };
      }
    } catch (error) {
      results.issues.push('Failed to check existing containers');
    }

    // Detect network configuration
    results.networkMode = await this.detectNetworkMode();

    // Generate configuration suggestions
    results.suggestedConfig = await this.generateSuggestions(results, projectPath);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2)
      }]
    };
  }

  private async detectNetworkMode(): Promise<string> {
    try {
      const networks = await this.docker.listNetworks();
      const bridgeNetwork = networks.find((n: any) => n.Name === 'bridge');
      
      if (bridgeNetwork) {
        return 'bridge';
      }
      
      return 'host';
    } catch {
      return 'unknown';
    }
  }

  private async generateSuggestions(results: any, projectPath: string) {
    const suggestions: any = {
      recommendedSetup: 'docker-compose',
      environmentVariables: {
        LOCALSTACK_HOST: 'localhost',
        EDGE_PORT: '4566',
        SERVICES: 's3,lambda,sqs,sns,dynamodb',
      },
    };

    // Check if we're likely in a container environment
    try {
      await fs.access('/.dockerenv');
      suggestions.environmentVariables.LOCALSTACK_HOST = 'localstack';
      suggestions.note = 'Detected container environment - using container networking';
    } catch {
      // Not in container
    }

    // Analyze project for AWS service usage
    const detectedServices = await this.detectAWSServices(projectPath);
    if (detectedServices.length > 0) {
      suggestions.environmentVariables.SERVICES = detectedServices.join(',');
      suggestions.detectedServices = detectedServices;
    }

    // Docker Compose template
    if (!results.dockerComposeFound) {
      suggestions.dockerComposeTemplate = this.generateDockerComposeTemplate(suggestions);
    }

    return suggestions;
  }

  private async detectAWSServices(projectPath: string): Promise<string[]> {
    const services = new Set<string>();
    const servicePatterns = {
      s3: /aws\.s3|S3Client|@aws-sdk\/client-s3/,
      lambda: /aws\.lambda|LambdaClient|@aws-sdk\/client-lambda/,
      dynamodb: /aws\.dynamodb|DynamoDBClient|@aws-sdk\/client-dynamodb/,
      sqs: /aws\.sqs|SQSClient|@aws-sdk\/client-sqs/,
      sns: /aws\.sns|SNSClient|@aws-sdk\/client-sns/,
      apigateway: /aws\.apigateway|APIGatewayClient|@aws-sdk\/client-api-gateway/,
      cognito: /aws\.cognito|CognitoClient|@aws-sdk\/client-cognito/,
      stepfunctions: /aws\.stepfunctions|SFNClient|@aws-sdk\/client-sfn/,
    };

    try {
      const files = await this.findSourceFiles(projectPath);
      
      for (const file of files) {
        try {
          const content = await fs.readFile(file, 'utf8');
          
          Object.entries(servicePatterns).forEach(([service, pattern]) => {
            if (pattern.test(content)) {
              services.add(service);
            }
          });
        } catch {
          // Skip files we can't read
        }
      }
    } catch {
      // Return default services if detection fails
      return ['s3', 'lambda', 'dynamodb', 'sqs'];
    }

    return Array.from(services);
  }

  private async findSourceFiles(dir: string, maxDepth = 3): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.js', '.ts', '.py', '.json', '.yml', '.yaml'];

    async function walk(currentDir: string, depth: number) {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);
          
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }

    await walk(dir, 0);
    return files;
  }

  private generateDockerComposeTemplate(suggestions: any): string {
    return `version: '3.8'

services:
  localstack:
    container_name: localstack
    image: localstack/localstack:latest
    ports:
      - "4566:4566"
    environment:
      - SERVICES=${suggestions.environmentVariables.SERVICES}
      - DEBUG=1
      - DOCKER_HOST=unix:///var/run/docker.sock
      - LOCALSTACK_HOST=${suggestions.environmentVariables.LOCALSTACK_HOST}
    volumes:
      - "\${TMPDIR:-/tmp}/localstack:/var/lib/localstack"
      - "/var/run/docker.sock:/var/run/docker.sock"
    networks:
      - localstack-network

networks:
  localstack-network:
    driver: bridge`;
  }
}