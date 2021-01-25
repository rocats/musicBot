```go
type Song []struct {
	ID      int             `json:"id"`
	Name    string          `json:"name"`
	Artists [][]interface{} `json:"artists"`
	Album   struct {
		ID          int           `json:"id"`
		Name        string        `json:"name"`
		Artist      []interface{} `json:"artist"`
		PublishTime int64         `json:"publishTime"`
		Size        int           `json:"size"`
		CopyrightID int           `json:"copyrightId"`
		Status      int           `json:"status"`
		PicID       int64         `json:"picId"`
		Mark        int           `json:"mark"`
	} `json:"album"`
	Duration    int           `json:"duration"`
	CopyrightID int           `json:"copyrightId"`
	Status      int           `json:"status"`
	Alias       []interface{} `json:"alias"`
	Rtype       int           `json:"rtype"`
	Ftype       int           `json:"ftype"`
	Mvid        int           `json:"mvid"`
	Fee         int           `json:"fee"`
	RURL        interface{}   `json:"rUrl"`
	Mark        int           `json:"mark"`
}
```