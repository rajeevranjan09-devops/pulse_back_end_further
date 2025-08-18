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
helm upgrade --install mongo bitnami/mongodb -n mongodb --set service.type=LoadBalancer
```
Wait until the MongoDB service shows an external IP.

## 2. Retrieve MongoDB credentials and IP
```bash
kubectl get svc mongo-mongodb -n mongodb -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
kubectl get secret mongo-mongodb -n mongodb -o jsonpath='{.data.mongodb-root-password}' | base64 -d
```

## 3. Create the `pipeline_monitor` database
Use the IP and password from step 2 to connect with MongoDB Compass and
create a database named `pipeline_monitor`.

## 4. Create a GitHub PAT token
Generate a personal access token with the required repository and workflow
permissions. This token will be stored in a Kubernetes secret.

## 5. Populate secrets in `k8s/manifest.yaml`
Open `k8s/manifest.yaml` and replace the placeholder values in `stringData`
with:
- `MONGO_URI` built from the MongoDB IP and root password
- `GITHUB_PAT` from step 4
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (leave empty for now if
  OAuth app not created yet)
- `GEMINI_API_KEY` from your `.env`
- `JWT_SECRET` (any strong random string)

## 6. Deploy the LoadBalancer service and obtain its IP
```bash
kubectl apply -f k8s/manifest.yaml
kubectl get svc pulse-backend -w
```
Record the external IP once it appears.

## 7. Create a GitHub OAuth app
Use the service IP from step 6 as both the homepage URL and callback URL:
```
Homepage URL: http://<LB_IP>:5000
Callback URL: http://<LB_IP>:5000/auth/github/callback
```
Generate a client secret.

## 8. Update OAuth and Gemini settings
Edit `k8s/manifest.yaml` again and fill in:
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- Replace `<LOAD_BALANCER_IP>` placeholders in `SWAGGER_SERVER_URL` and
  `GITHUB_CALLBACK_URL` with the IP from step 6
- Ensure `GEMINI_API_KEY` and `GEMINI_MODEL` are set in the secret

## 9. Apply the manifest
```bash
kubectl apply -f k8s/manifest.yaml
```
This creates the secret, deployment, and service (or updates them if they
already exist).

## 10. Verify the deployment
```bash
kubectl get pods
curl http://<LB_IP>:5000/api-docs/
```
The Swagger UI should be available in the browser at
`http://<LB_IP>:5000/api-docs/`.
