# Deploying the Backend to Azure Kubernetes Service (AKS)

This guide documents the process required to run the backend application on an
Azure Kubernetes Service cluster.

## Prerequisites
- Azure CLI, `kubectl`, and `helm` installed and configured
- Access to an AKS cluster
- MongoDB Compass for creating the initial database
- GitHub account with permission to create PAT tokens and OAuth apps
- Gemini API key

## 1. Install MongoDB in AKS using Helm
```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm install mongo bitnami/mongodb
```
Wait for the MongoDB service to obtain an external IP.

## 2. Retrieve MongoDB credentials and IP address
```bash
kubectl get svc mongo-mongodb -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
kubectl get secret mongo-mongodb -o jsonpath='{.data.mongodb-root-password}' | base64 -d
```

## 3. Create the `pipeline_monitor` database
Use the IP and password from step 2 to connect to MongoDB with MongoDB Compass
and create a database named `pipeline_monitor`.

## 4. Create a GitHub PAT token
Generate a personal access token with the required repository and user
permissions. This token will be stored in a Kubernetes secret.

## 5. Add secrets to the Kubernetes manifest
Edit the secret manifest in `k8s/backend-secret.yaml` and include:
- `MONGODB_URL` built from the password and MongoDB IP
- `GITHUB_PAT` containing the token

## 6. Deploy the backend service
```bash
kubectl apply -f k8s/backend-service.yaml
```
Record the external IP once the load balancer is ready.

## 7. Create a GitHub OAuth app
Use the service IP from step 6 as both the homepage URL and callback URL.
Generate the client secret.

## 8. Add GitHub OAuth credentials
Update `k8s/backend-secret.yaml` with:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## 9. Include the Gemini API key
Add `GEMINI_API_KEY` to the same secret manifest.

## 10. Set the Swagger server URL
Include an environment variable `SWAGGER_SERVER_URL` in
`k8s/backend-deployment.yaml` pointing to the load balancer IP from step 6.

## 11. Apply the deployment and secrets
```bash
kubectl apply -f k8s/backend-secret.yaml
kubectl apply -f k8s/backend-deployment.yaml
```

## 12. Verify the deployment
Visit:
```
http://<app-load-balancer-ip>:5000/api-docs/
```
The Swagger UI should be displayed.

## Manifest overview
- `k8s/backend-secret.yaml`: Kubernetes secret definitions
- `k8s/backend-service.yaml`: Load balancer service
- `k8s/backend-deployment.yaml`: Backend deployment

