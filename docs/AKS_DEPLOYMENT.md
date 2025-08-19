# Deploying the Backend to Azure Kubernetes Service (AKS)


The following steps describe how to run the Pulse backend on an existing AKS cluster.
Each step includes the exact commands that were used during setup.

## Prerequisites
- Azure CLI, `kubectl`, and `helm` installed and logged in
- Access to an AKS cluster
- MongoDB Compass for creating the initial database
- GitHub account with permission to create PAT tokens and OAuth apps
- Gemini API key

## 1. Install MongoDB with Helm
Deploy MongoDB in its own namespace so it is isolated from the application.
```bash
kubectl create namespace mongodb
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
helm upgrade --install mongo bitnami/mongodb -n mongodb --set service.type=LoadBalancer --set architecture=standalone
```
Wait until the MongoDB service shows an external IP.

## 2. Retrieve MongoDB credentials and IP
```bash
kubectl get svc mongo-mongodb -n mongodb -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
kubectl get secret mongo-mongodb -n mongodb -o jsonpath='{.data.mongodb-root-password}' | base64 -d
```

## 3. Create the `pipeline_monitor` database
Use the IP and password from step 2 to connect with MongoDB Compass GUI application. 
Create a database named `pipeline_monitor`.

## 4. Create a GitHub PAT token
Generate a personal access token with the required repository and workflow
permissions. This token will be stored in a Kubernetes secret.

## 5. Add secrets to the Kubernetes manifest
Edit the secret section in `k8s/manifest.yaml` & `.env` file and include:
- `MONGODB_URL` built from the password and MongoDB IP
- `GITHUB_PAT` containing the token

## 6. Deploy the backend service
```bash
kubectl apply -f k8s/backend-service.yaml
```
Record the external IP once the load balancer is ready.


## 7. Deploy the LoadBalancer service and obtain its IP
```bash
kubectl apply -f k8s/backend-service.yaml
kubectl get svc backend-service -w
```
Record the external IP once it appears.

## 8. Create a GitHub OAuth app
Use the service IP from step 7 as both the homepage URL and callback URL:
```
Homepage URL: http://<LB_IP>:5000
Callback URL: http://<LB_IP>:5000/auth/github/callback
```
Generate a client secret.

## 9. Update OAuth and Gemini settings
Edit `k8s/manifest.yaml` again and fill in:
- `GITHUB_CLIENT_ID`, also update it in `.env` file.
- `GITHUB_CLIENT_SECRET` , also update it in `.env` file.
- Replace `<LOAD_BALANCER_IP>` placeholders in `SWAGGER_SERVER_URL` in deployment section and update the `GITHUB_CALLBACK_URL` which are there in step 8 in the secrets section.
- Replace the `GEMINI_API_KEY` and `GEMINI_MODEL` with the values which are there in the .env file.

## 10. Build and Push the Docker image
Build the `Dockerfile` from /backend folder and push the image to container registry:
```bash
- docker login
- username & password.
- docker build -t <your-registry>/pulse-backend:1.0 .
```

## 10. Apply the manifest
Update `<your-registry>` with the registry which the docker registry which you built and pushed the image. 
```bash
kubectl apply -f k8s/manifest.yaml
```
This creates the secret, deployment (or updates them if they already exist).

## 11. Verify the deployment
```bash
kubectl get pods
curl http://<LB_IP>:5000/api-docs/
```
The Swagger UI should be available in the browser at
`http://<LB_IP>:5000/api-docs/`.
