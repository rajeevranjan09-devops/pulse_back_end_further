import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Pipeline Monitor API',
      version: '1.0.0',
      description: 'Backend API for GitHub pipeline monitoring',
    },
    servers: [
      { url: 'http://localhost:5000' }
    ]
  },
  apis: ['./src/routes/*.js'], // look for Swagger comments in routes
};

const specs = swaggerJsdoc(options);

export { swaggerUi, specs };
