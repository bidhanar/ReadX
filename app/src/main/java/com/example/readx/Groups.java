package com.example.readx;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ListView;

import com.parse.FindCallback;
import com.parse.Parse;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;

import java.util.ArrayList;
import java.util.List;

public class Groups extends AppCompatActivity {
    Button button;
    Button logout;
    ListView listView;
    EditText search;
    ImageButton userSearch;
    ArrayList<String> arrayList;
    ArrayAdapter arrayAdapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_groups);
        Parse.initialize(new Parse.Configuration.Builder(this)
                .applicationId(getString(R.string.back4app_app_id))
                .clientKey(getString(R.string.back4app_client_key))
                .server(getString(R.string.back4app_server_url))
                .build()
        );
        button = findViewById(R.id.button);
        logout = findViewById(R.id.logout);
        listView = findViewById(R.id.listview1);
        search = findViewById(R.id.search);
        userSearch = findViewById(R.id.userSearch);
        arrayList = new ArrayList<>();
        String user = getIntent().getStringExtra("user");
        ParseQuery<ParseUser> query = ParseUser.getQuery();

        userSearch.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if(arrayList.size() != 0){
                    arrayList.clear();
                }
                query.addAscendingOrder("username");
                query.findInBackground(new FindCallback<ParseUser>() {
                    @Override
                    public void done(List<ParseUser> objects, ParseException e) {
                        if (e == null){
                            if(objects.size() > 0){
                                for(ParseUser user : objects){
                                    if (user.getUsername().contains(search.getText().toString())){
                                        arrayList.add(user.getUsername());
                                    }

                                }
                                if (arrayList.size() == 0){
                                    arrayList.add("No Users Found!!!");
                                }
                                arrayAdapter = new ArrayAdapter(getApplicationContext(), android.R.layout.simple_list_item_1, arrayList);
                                listView.setAdapter(arrayAdapter);
                            }
                        }
                        else{
                            e.printStackTrace();
                        }
                    }
                });
            }
        });


        logout.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                ParseUser.logOut();
                Intent intent = new Intent(getApplicationContext(),MainActivity.class);
                startActivity(intent);
            }
        });


        button.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent intent = new Intent(getApplicationContext(), readPdf.class);
                intent.putExtra("name",user);
                startActivity(intent);
            }
        });
    }


}