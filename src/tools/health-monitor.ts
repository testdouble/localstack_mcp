import axios from 'axios';

interface ServiceStatus {
  service: string;
  status: 'available' | 'disabled' | 'error';
  details?: any;
}

interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  services: ServiceStatus[];
  diagnostics: any;
  recommendations: string[];
  timestamp: string;
}

export class LocalStackHealthMonitor {
  async checkHealth(endpoint: string = 'http://localhost:4566'): Promise<any> {
    try {
      const result = await this.performHealthCheck(endpoint);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      const errorResult = {
        overall: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        recommendations: this.getConnectionFailureRecommendations(),
        timestamp: new Date().toISOString(),
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(errorResult, null, 2)
        }]
      };
    }
  }

  private async performHealthCheck(endpoint: string): Promise<HealthCheckResult> {
    const baseUrl = endpoint.replace(/\/$/, '');
    
    // Check basic connectivity
    const healthResponse = await axios.get(`${baseUrl}/_localstack/health`, {
      timeout: 5000,
    });

    const healthData = healthResponse.data;
    const services: ServiceStatus[] = [];
    const recommendations: string[] = [];

    // Parse service status
    if (healthData.services) {
      Object.entries(healthData.services).forEach(([service, status]) => {
        services.push({
          service,
          status: status as any,
        });
      });
    }

    // Get diagnostic information
    let diagnostics: any = {};
    try {
      const diagResponse = await axios.get(`${baseUrl}/_localstack/diagnose`, {
        timeout: 3000,
      });
      diagnostics = diagResponse.data;
    } catch {
      recommendations.push('Unable to retrieve diagnostic information');
    }

    // Get initialization status
    let initStatus: any = {};
    try {
      const initResponse = await axios.get(`${baseUrl}/_localstack/init`, {
        timeout: 3000,
      });
      initStatus = initResponse.data;
    } catch {
      // Init endpoint might not be available in all versions
    }

    // Analyze overall health
    const unavailableServices = services.filter(s => s.status === 'error').length;
    const disabledServices = services.filter(s => s.status === 'disabled').length;
    
    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (unavailableServices === 0) {
      overall = 'healthy';
    } else if (unavailableServices > services.length / 2) {
      overall = 'unhealthy';
    } else {
      overall = 'degraded';
    }

    // Generate recommendations
    if (unavailableServices > 0) {
      recommendations.push(`${unavailableServices} services are unavailable - check container resources`);
    }
    
    if (disabledServices > 0) {
      recommendations.push(`${disabledServices} services are disabled - update SERVICES environment variable if needed`);
    }

    // Check for common performance issues
    await this.addPerformanceRecommendations(baseUrl, recommendations);

    return {
      overall,
      services,
      diagnostics: {
        ...diagnostics,
        initStatus,
      },
      recommendations,
      timestamp: new Date().toISOString(),
    };
  }

  private async addPerformanceRecommendations(baseUrl: string, recommendations: string[]): Promise<void> {
    try {
      // Test response time for basic operation
      const start = Date.now();
      await axios.get(`${baseUrl}/_localstack/health`);
      const responseTime = Date.now() - start;

      if (responseTime > 5000) {
        recommendations.push('High response time detected - consider increasing container memory or reducing enabled services');
      }

      // Check if Lambda cold start optimization is enabled
      try {
        const configResponse = await axios.get(`${baseUrl}/_localstack/config`);
        const config = configResponse.data;
        
        if (config.LAMBDA_EXECUTOR !== 'docker-reuse') {
          recommendations.push('Consider setting LAMBDA_EXECUTOR=docker-reuse for faster Lambda execution');
        }
      } catch {
        // Config endpoint might not be available
      }

    } catch {
      // Performance checks failed - container might be under stress
      recommendations.push('Performance checks failed - container may be under high load');
    }
  }

  private getConnectionFailureRecommendations(): string[] {
    return [
      'Verify LocalStack container is running: docker ps | grep localstack',
      'Check if port 4566 is accessible: curl -f http://localhost:4566/_localstack/health',
      'Ensure no firewall is blocking the connection',
      'Verify LocalStack endpoint URL is correct',
      'Check Docker networking configuration',
      'Review LocalStack container logs: docker logs localstack',
    ];
  }

  // Additional utility method for continuous monitoring
  async monitorHealth(endpoint: string, intervalMs: number = 30000): Promise<void> {
    console.log(`Starting continuous health monitoring for ${endpoint}`);
    
    const monitor = async () => {
      try {
        const result = await this.performHealthCheck(endpoint);
        const timestamp = new Date().toLocaleTimeString();
        
        if (result.overall === 'healthy') {
          console.log(`[${timestamp}] ✅ LocalStack healthy - ${result.services.length} services available`);
        } else if (result.overall === 'degraded') {
          console.log(`[${timestamp}] ⚠️  LocalStack degraded - some services unavailable`);
          result.recommendations.forEach(rec => console.log(`   - ${rec}`));
        } else {
          console.log(`[${timestamp}] ❌ LocalStack unhealthy`);
          result.recommendations.forEach(rec => console.log(`   - ${rec}`));
        }
      } catch (error) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] 💥 Health check failed: ${error instanceof Error ? error.message : error}`);
      }
    };

    // Run initial check
    await monitor();
    
    // Set up interval
    setInterval(monitor, intervalMs);
  }
}