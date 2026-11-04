
# Login
```
curl -X POST https://turbo-invention-g49j6v46pg59cp4w7-3000.app.github.dev/login   -H "Content-Type: application/json"   -d '{"email":"slk","password":"abcd1234"}'
```

return  from curl

{"accessToken":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNmFlYjFmYjk5MWY5MjgyZjY4ZThkNGJlIiwiZW1haWwiOiJzbGsiLCJpYXQiOjE3OTM3OTY0NzksImV4cCI6MTc5MzgwMDA3OX0.YoqgUpVvk32TrvHDd6rPEySp__XVUlvo_xmz0VjkVjg"}

# Test login
```
curl https://turbo-invention-g49j6v46pg59cp4w7-3000.app.github.dev/profile \
> -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNmFlYjFmYjk5MWY5MjgyZjY4ZThkNGJlIiwiZW1haWwiOiJzbGsiLCJpYXQiOjE3OTM3OTcwMjEsImV4cCI6MTc5MzgwMDYyMX0.7izMkaFJbj8iZSOIxKX-O_L8cSKq
ndyPavtyeuXE88Q"
```

# return Receipt data
```
curl -X GET https://turbo-invention-g49j6v46pg59cp4w7-3000.app.github.dev/recipes
```